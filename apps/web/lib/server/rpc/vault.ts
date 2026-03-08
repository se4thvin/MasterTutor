import type { VaultItemView } from "@mastertutor/contracts";
import {
  VaultAliasTaken,
  VaultAuditCursorInvalid,
  VaultNotFound,
  createVaultItem,
  deleteVaultItem,
  forgetBrowserSession,
  getVaultItem,
  listVaultAudit,
  listVaultItems,
  removeVaultSecret,
  setVaultSecret,
  submitOtpCode,
  workspaceIdOf,
  type DbHandle,
  type VaultItemListRow,
} from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import type { Sealer } from "../vault/sealer.ts";
import { liveOs } from "./live-os.ts";

interface VaultProcedureDeps {
  sealer(): Sealer;
  db(): DbHandle;
}

function toView(row: VaultItemListRow): VaultItemView {
  return {
    id: row.id,
    alias: row.alias,
    origin: row.origin,
    label: row.label,
    fields: row.fields,
    hasImap: row.hasImap,
    sessionSaved: row.sessionSaved,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapVaultError(error: unknown): never {
  if (error instanceof VaultNotFound)
    throw new ORPCError("NOT_FOUND", { message: "That vault item doesn't exist." });
  if (error instanceof VaultAliasTaken)
    throw new ORPCError("CONFLICT", { message: "That alias is already in use." });
  if (error instanceof VaultAuditCursorInvalid)
    throw new ORPCError("BAD_REQUEST", { message: "That page of the audit log doesn't exist." });
  throw error;
}

/**
 * vault.* and runs.submitOtp (spec §9). Values are validated by the contract (Task 2), sealed on
 * arrival with the public key only, and never read back; the Phase 0 grants enforce the last part.
 */
export function createVaultProcedures(deps: VaultProcedureDeps) {
  /** Every vault procedure runs in the viewer's workspace (D4: one workspace in v1). */
  const scoped = liveOs.use(async ({ context, next }) => {
    const db = deps.db();
    const workspaceId = await workspaceIdOf(db.db, context.viewer.id);
    if (workspaceId === null) throw new ORPCError("FORBIDDEN");
    return next({ context: { db, workspaceId, actor: context.viewer.id } });
  });

  const vault = {
    list: scoped.vault.list.handler(async ({ context }) => ({
      items: (await listVaultItems(context.db.db, context.workspaceId)).map(toView),
    })),

    create: scoped.vault.create.handler(async ({ context, input }) => {
      const entries = Object.entries(input.secrets).filter(
        (entry): entry is [keyof typeof input.secrets, string] => entry[1] !== undefined,
      );
      const secrets = await Promise.all(
        entries.map(async ([field, value]) => ({
          field,
          sealed: await deps.sealer().seal(
            {
              kind: "secret",
              workspaceId: context.workspaceId,
              alias: input.alias,
              origin: input.origin,
              field,
            },
            value,
          ),
        })),
      );
      try {
        await createVaultItem(context.db.db, {
          workspaceId: context.workspaceId,
          alias: input.alias,
          origin: input.origin,
          label: input.label,
          imap: input.imap,
          secrets,
          actor: context.actor,
        });
      } catch (error) {
        mapVaultError(error);
      }
      const created = (await listVaultItems(context.db.db, context.workspaceId)).find(
        (row) => row.alias === input.alias,
      );
      if (!created) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return toView(created);
    }),

    setSecret: scoped.vault.setSecret.handler(async ({ context, input }) => {
      const item = await getVaultItem(context.db.db, context.workspaceId, input.itemId);
      if (!item) mapVaultError(new VaultNotFound());
      if (input.field === "imap_password" && item.imap === null)
        throw new ORPCError("BAD_REQUEST", {
          message: "Add mail settings before an email-code password.",
        });
      const sealed = await deps.sealer().seal(
        {
          kind: "secret",
          workspaceId: context.workspaceId,
          alias: item.alias,
          origin: item.origin,
          field: input.field,
        },
        input.value,
      );
      try {
        await setVaultSecret(context.db.db, {
          workspaceId: context.workspaceId,
          itemId: item.id,
          secret: { field: input.field, sealed },
          actor: context.actor,
        });
      } catch (error) {
        mapVaultError(error);
      }
      return { ok: true as const };
    }),

    removeSecret: scoped.vault.removeSecret.handler(async ({ context, input }) => {
      try {
        await removeVaultSecret(context.db.db, {
          workspaceId: context.workspaceId,
          itemId: input.itemId,
          field: input.field,
          actor: context.actor,
        });
      } catch (error) {
        mapVaultError(error);
      }
      return { ok: true as const };
    }),

    delete: scoped.vault.delete.handler(async ({ context, input }) => {
      try {
        await deleteVaultItem(context.db.db, {
          workspaceId: context.workspaceId,
          itemId: input.itemId,
          actor: context.actor,
        });
      } catch (error) {
        mapVaultError(error);
      }
      return { ok: true as const };
    }),

    /** Idempotent (E6): forgetting nothing is ok and audited as outcome "none". */
    forgetSession: scoped.vault.forgetSession.handler(async ({ context, input }) => {
      await forgetBrowserSession(context.db.db, {
        workspaceId: context.workspaceId,
        alias: input.alias,
        origin: input.origin,
        actor: context.actor,
      });
      return { ok: true as const };
    }),

    audit: scoped.vault.audit.handler(async ({ context, input }) => {
      const page = await listVaultAudit(context.db.db, context.workspaceId, {
        limit: input.limit,
        cursor: input.cursor ?? null,
      }).catch(mapVaultError);
      return {
        items: page.items.map((row) => ({ ...row, at: row.at.toISOString() })),
        nextCursor: page.nextCursor,
      };
    }),
  };

  /** CodeSlots submit: sealed the moment it arrives, never logged (spec §9, §11.4). */
  const submitOtp = scoped.runs.submitOtp.handler(async ({ context, input }) => {
    const sealed = await deps
      .sealer()
      .seal({ kind: "otp", workspaceId: context.workspaceId, runId: input.runId }, input.code);
    const outcome = await submitOtpCode(context.db.db, {
      workspaceId: context.workspaceId,
      runId: input.runId,
      sealed,
    });
    if (outcome === "not_found")
      throw new ORPCError("NOT_FOUND", { message: "That run doesn't exist." });
    if (outcome === "finished")
      throw new ORPCError("CONFLICT", { message: "This run has already finished." });
    return { ok: true as const };
  });

  return { vault, submitOtp };
}
