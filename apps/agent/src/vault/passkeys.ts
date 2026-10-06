import {
  toOrigin,
  type ApprovalRequest,
  type UsePasskeyArgs,
  type UsePasskeyResult,
} from "@mastertutor/contracts";
import {
  appendVaultAudit,
  findVaultItemByAlias,
  listVaultItemRecords,
  putVaultSecret,
  type VaultItemRecord,
} from "@mastertutor/db";
import { SealError, sealValue } from "@mastertutor/sealing";
import type { CDPSession } from "playwright-core";
import { z } from "zod";
import type { VaultDeps } from "./context.ts";
import { approvedBy, credentialApproval } from "./grants.ts";
import type { BrowserSession, ToolContext } from "./runtime.ts";
import { NOT_STORED, withItemSecret } from "./secrets.ts";

/** The authenticator stays armed this long waiting for the site's ceremony. */
export const PASSKEY_ARM_MS = 60_000;

/** Spec §9: ctap2, internal transport, user verification on. */
const AUTHENTICATOR_OPTIONS = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

export const StoredPasskey = z.object({
  credentialId: z.string().min(1),
  isResidentCredential: z.boolean(),
  rpId: z.string().min(1),
  privateKey: z.string().min(1),
  userHandle: z.string().optional(),
  signCount: z.number().int().nonnegative(),
  backupEligibility: z.boolean().optional(),
  backupState: z.boolean().optional(),
  userName: z.string().optional(),
  userDisplayName: z.string().optional(),
});
export type StoredPasskey = z.infer<typeof StoredPasskey>;
const StoredPasskeys = z.array(StoredPasskey).max(20);

/** The RP ID must be the pinned host or a registrable parent of it (deviation 10). */
export function rpIdMatchesOrigin(rpId: string, origin: string): boolean {
  const host = new URL(origin).hostname;
  const id = rpId.toLowerCase();
  return id.includes(".") && (host === id || host.endsWith(`.${id}`));
}

export interface EnrolmentHandle {
  readonly cdp: CDPSession;
  readonly authenticatorId: string;
}

export interface PasskeyEnrolment {
  /** B6 calls this on giveControl: registrations during takeover land in this authenticator. */
  begin(session: BrowserSession): Promise<EnrolmentHandle>;
  /** B6 calls this on hand back: exports, seals and removes the authenticator. Returns count sealed. */
  finish(handle: EnrolmentHandle, run: { workspaceId: string; runId: string }): Promise<number>;
}

export interface Passkeys {
  approval(
    run: { workspaceId: string },
    url: string,
    args: UsePasskeyArgs,
  ): Promise<ApprovalRequest | null>;
  use(ctx: ToolContext, args: UsePasskeyArgs): Promise<UsePasskeyResult>;
  disarm(runId: string): Promise<void>;
  enrolment: PasskeyEnrolment;
}

interface Armed {
  cdp: CDPSession;
  authenticatorId: string;
  timer: NodeJS.Timeout;
  listener: (event: { authenticatorId: string }) => void;
}

const removeAuthenticator = (cdp: CDPSession, authenticatorId: string) =>
  cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined);

export function createPasskeys(deps: VaultDeps): Passkeys {
  const armed = new Map<string, Armed>();

  async function load(workspaceId: string, item: VaultItemRecord): Promise<StoredPasskey[]> {
    const stored = await withItemSecret(deps, workspaceId, item, "passkey", async (text) =>
      StoredPasskeys.parse(JSON.parse(text)),
    );
    return stored === NOT_STORED ? [] : stored;
  }

  async function save(workspaceId: string, item: VaultItemRecord, passkeys: StoredPasskey[]) {
    const sealed = await sealValue(
      deps.keys.publicKey,
      { kind: "secret", workspaceId, alias: item.alias, origin: item.origin, field: "passkey" },
      JSON.stringify(passkeys),
    );
    await putVaultSecret(deps.db, { workspaceId, itemId: item.id }, { field: "passkey", sealed });
  }

  async function merge(workspaceId: string, item: VaultItemRecord, credential: StoredPasskey) {
    const others = (await load(workspaceId, item)).filter(
      (passkey) => passkey.credentialId !== credential.credentialId,
    );
    await save(workspaceId, item, [...others, credential]);
  }

  async function disarm(runId: string): Promise<void> {
    const entry = armed.get(runId);
    if (!entry) return;
    armed.delete(runId);
    clearTimeout(entry.timer);
    entry.cdp.off("WebAuthn.credentialAsserted", entry.listener);
    await removeAuthenticator(entry.cdp, entry.authenticatorId);
  }

  async function onAsserted(
    ctx: ToolContext,
    item: VaultItemRecord,
    entry: Armed,
    approver: string,
  ) {
    try {
      // Keep the sign counter current; some relying parties reject a counter that goes backwards.
      const { credentials } = await entry.cdp.send("WebAuthn.getCredentials", {
        authenticatorId: entry.authenticatorId,
      });
      for (const credential of credentials) {
        const parsed = StoredPasskey.safeParse(credential);
        if (parsed.success) await merge(ctx.workspaceId, item, parsed.data);
      }
      await appendVaultAudit(deps.db, {
        workspaceId: ctx.workspaceId,
        itemId: item.id,
        alias: item.alias,
        origin: item.origin,
        field: "passkey",
        action: "passkey",
        runId: ctx.runId,
        approvedBy: approver,
        outcome: "asserted",
      });
      deps.logins.noteLogin(ctx.runId, item.alias, item.origin);
    } catch (error) {
      deps.log.warn(
        { alias: item.alias, reason: (error as Error).name },
        "passkey bookkeeping failed",
      );
    } finally {
      await disarm(ctx.runId);
    }
  }

  const enrolment: PasskeyEnrolment = {
    async begin(session) {
      const cdp = await session.cdp();
      await cdp.send("WebAuthn.enable", { enableUI: false });
      const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: AUTHENTICATOR_OPTIONS,
      });
      return { cdp, authenticatorId };
    },
    async finish(handle, run) {
      try {
        const { credentials } = await handle.cdp.send("WebAuthn.getCredentials", {
          authenticatorId: handle.authenticatorId,
        });
        const items = await listVaultItemRecords(deps.db, run.workspaceId);
        let sealed = 0;
        for (const credential of credentials) {
          const parsed = StoredPasskey.safeParse(credential);
          if (!parsed.success) continue;
          const matches = items.filter((item) => rpIdMatchesOrigin(parsed.data.rpId, item.origin));
          const item = matches[0];
          if (!item || matches.length !== 1) {
            deps.log.warn(
              { matches: matches.length },
              "enrolled passkey matches no single vault item",
            );
            continue;
          }
          await merge(run.workspaceId, item, parsed.data);
          await appendVaultAudit(deps.db, {
            workspaceId: run.workspaceId,
            itemId: item.id,
            alias: item.alias,
            origin: item.origin,
            field: "passkey",
            action: "update",
            runId: run.runId,
            approvedBy: null,
            outcome: "enrolled",
          });
          sealed++;
        }
        return sealed;
      } finally {
        await removeAuthenticator(handle.cdp, handle.authenticatorId);
      }
    },
  };

  return {
    enrolment,
    disarm,
    async approval(run, url, args) {
      const item = await findVaultItemByAlias(deps.db, run.workspaceId, args.alias);
      return item ? credentialApproval(deps, url, item) : null;
    },
    async use(ctx, args) {
      const item = await findVaultItemByAlias(deps.db, ctx.workspaceId, args.alias);
      const audit = (action: "passkey" | "denied", outcome: string, approver: string | null) =>
        appendVaultAudit(deps.db, {
          workspaceId: ctx.workspaceId,
          itemId: item?.id ?? null,
          alias: args.alias,
          origin: item?.origin ?? null,
          field: "passkey",
          action,
          runId: ctx.runId,
          approvedBy: approver,
          outcome,
        });
      if (!item) {
        await audit("denied", "unknown_alias", null);
        return { error: "unknown_alias" };
      }
      if (toOrigin(ctx.session.page.url()) !== item.origin) {
        await audit("denied", "origin_mismatch", null);
        return { error: "origin_mismatch" };
      }
      const approver = await approvedBy(deps, ctx.approval, item, ctx.session.page.url());
      if (approver === null) {
        await audit("denied", "approval_required", null);
        return { error: "approval_required" };
      }
      let usable: StoredPasskey[];
      try {
        usable = (await load(ctx.workspaceId, item)).filter((p) =>
          rpIdMatchesOrigin(p.rpId, item.origin),
        );
      } catch (error) {
        if (!(error instanceof SealError)) throw error;
        await audit("passkey", error.code, approver); // F16
        return { error: "ceremony_failed" };
      }
      if (usable.length === 0) {
        await audit("passkey", "no_passkey", approver);
        return { error: "no_passkey" };
      }
      ctx.session.guard.assertAgent(ctx.signal);
      await disarm(ctx.runId);
      const cdp = await ctx.session.cdp();
      let authenticatorId: string | null = null;
      try {
        await cdp.send("WebAuthn.enable", { enableUI: false });
        ({ authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
          options: AUTHENTICATOR_OPTIONS,
        }));
        const id = authenticatorId;
        for (const credential of usable)
          await cdp.send("WebAuthn.addCredential", { authenticatorId: id, credential });
        const entry: Armed = {
          cdp,
          authenticatorId: id,
          timer: setTimeout(() => void disarm(ctx.runId), PASSKEY_ARM_MS),
          listener: (event) => {
            if (event.authenticatorId === id) void onAsserted(ctx, item, entry, approver);
          },
        };
        entry.timer.unref();
        cdp.on("WebAuthn.credentialAsserted", entry.listener);
        armed.set(ctx.runId, entry);
      } catch (error) {
        // S8: an authenticator that holds keys and auto-presence must never outlive a failed arm.
        if (authenticatorId !== null) await removeAuthenticator(cdp, authenticatorId);
        deps.log.warn({ alias: item.alias, reason: (error as Error).name }, "use_passkey failed");
        await audit("passkey", "ceremony_failed", approver);
        return { error: "ceremony_failed" };
      }
      await audit("passkey", "armed", approver);
      return { ok: true };
    },
  };
}
