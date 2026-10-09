import {
  toOrigin,
  type ApprovalRequest,
  type Decider,
  type UsePasskeyArgs,
  type UsePasskeyResult,
} from "@mastertutor/contracts";
import {
  appendVaultAudit,
  findVaultItemByAlias,
  listVaultItemRecords,
  lockVaultItemSecrets,
  putVaultSecret,
  type VaultItemRecord,
} from "@mastertutor/db";
import { SealError, sealValue } from "@mastertutor/sealing";
import type { CDPSession } from "playwright-core";
import { z } from "zod";
import type { VaultDeps } from "./context.ts";
import { approvedBy, credentialApproval } from "./grants.ts";
import type { ApprovalContext, BrowserSession, ToolContext } from "./runtime.ts";
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
  /** use_passkey's approve phase: a first-use card for the page as it is now (N8). */
  approval(ctx: ApprovalContext, args: UsePasskeyArgs): Promise<ApprovalRequest | null>;
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

/** Adds or replaces one credential in the item's sealed passkey list. */
export async function mergeStoredPasskey(
  deps: Pick<VaultDeps, "db" | "keys">,
  workspaceId: string,
  item: VaultItemRecord,
  credential: StoredPasskey,
): Promise<void> {
  // One transaction under a per-item lock: concurrent runs never lose each other's update
  // (a sign counter going backwards makes some relying parties refuse the passkey).
  await deps.db.transaction(async (tx) => {
    await lockVaultItemSecrets(tx, item.id);
    const stored = await withItemSecret(
      { db: tx, keys: deps.keys },
      workspaceId,
      item,
      "passkey",
      async (text) => StoredPasskeys.parse(JSON.parse(text)),
    );
    const others = (stored === NOT_STORED ? [] : stored).filter(
      (passkey) => passkey.credentialId !== credential.credentialId,
    );
    const sealed = await sealValue(
      deps.keys.publicKey,
      { kind: "secret", workspaceId, alias: item.alias, origin: item.origin, field: "passkey" },
      JSON.stringify([...others, credential]),
    );
    await putVaultSecret(tx, { workspaceId, itemId: item.id }, { field: "passkey", sealed });
  });
}

export function createPasskeys(deps: VaultDeps, options: { armMs?: number } = {}): Passkeys {
  const armMs = options.armMs ?? PASSKEY_ARM_MS;
  const armed = new Map<string, Armed>();

  async function load(workspaceId: string, item: VaultItemRecord): Promise<StoredPasskey[]> {
    const stored = await withItemSecret(deps, workspaceId, item, "passkey", async (text) =>
      StoredPasskeys.parse(JSON.parse(text)),
    );
    return stored === NOT_STORED ? [] : stored;
  }

  const merge = (workspaceId: string, item: VaultItemRecord, credential: StoredPasskey) =>
    mergeStoredPasskey(deps, workspaceId, item, credential);

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
    approver: Decider,
  ) {
    try {
      // Keep the sign counter current; some relying parties reject a counter that goes backwards.
      const { credentials } = await entry.cdp.send("WebAuthn.getCredentials", {
        authenticatorId: entry.authenticatorId,
      });
      for (const credential of credentials) {
        // Only the item's own RP: a credential a page slipped into the armed authenticator for
        // another RP is never sealed into this item (review).
        const parsed = StoredPasskey.safeParse(credential);
        if (parsed.success && rpIdMatchesOrigin(parsed.data.rpId, item.origin))
          await merge(ctx.workspaceId, item, parsed.data);
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
    async approval(ctx, args) {
      const item = await findVaultItemByAlias(deps.db, ctx.workspaceId, args.alias);
      return item ? credentialApproval(deps, ctx.session.page.url(), item) : null;
    },
    async use(ctx, args) {
      const item = await findVaultItemByAlias(deps.db, ctx.workspaceId, args.alias);
      const audit = (action: "passkey" | "denied", outcome: string, approver: Decider | null) =>
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
          timer: setTimeout(() => void disarm(ctx.runId), armMs),
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
      try {
        await audit("passkey", "armed", approver);
      } catch (error) {
        // An arm nobody can audit is not left armed (review).
        await disarm(ctx.runId);
        throw error;
      }
      return { ok: true };
    },
  };
}
