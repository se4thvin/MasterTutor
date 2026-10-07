import type { VaultItemView } from "@mastertutor/contracts";
import {
  VaultAliasTaken,
  VaultAuditCursorInvalid,
  VaultNotFound,
  createVaultItem,
  deleteVaultItem,
  forgetBrowserSession,
  getVaultItem,
  getVaultItemListRow,
  listVaultAudit,
  listVaultItems,
  removeVaultSecret,
  setVaultSecret,
  submitOtpCode,
  type DbHandle,
  type VaultItemListRow,
} from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import type { Sealer } from "../vault/sealer.ts";
import { workspaceScoped } from "./workspace-scope.ts";

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
  /** Every vault procedure runs in the viewer's workspace (D4); one shared middleware. */
  const scoped = workspaceScoped(deps.db);

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
      let created: { id: string };
      try {
        created = await createVaultItem(context.db.db, {
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
      // The new row by id (review 10): no full re-list.
      const row = await getVaultItemListRow(context.db.db, context.workspaceId, created.id);
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return toView(row);
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
    if (outcome === "too_many")
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "This run already has unused codes. Wait for the agent to use one.",
      });
    return { ok: true as const };
  });

  return { vault, submitOtp };
}
