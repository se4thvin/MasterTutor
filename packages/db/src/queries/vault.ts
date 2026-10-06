import {
  POLICY_DECIDER,
  TERMINAL_RUN_STATUSES,
  encodeNotify,
  type ImapConfig,
  type VaultAuditAction,
  type VaultSecretField,
} from "@mastertutor/contracts";
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import {
  browserSessions,
  otpCodes,
  runs,
  vaultAudit,
  vaultGrants,
  vaultItems,
  vaultSecrets,
} from "../schema/index.ts";

/** A database or an open transaction. */
export type DbExecutor = Pick<
  Database,
  "select" | "selectDistinct" | "insert" | "update" | "delete" | "execute"
>;

export class VaultNotFound extends Error {
  constructor() {
    super("Vault item not found");
    this.name = "VaultNotFound";
  }
}

/** A listVaultAudit cursor that is not one this module issued (review 6): the caller's 400. */
export class VaultAuditCursorInvalid extends Error {
  constructor() {
    super("Invalid audit cursor");
    this.name = "VaultAuditCursorInvalid";
  }
}

export class VaultAliasTaken extends Error {
  constructor() {
    super("Vault alias already exists");
    this.name = "VaultAliasTaken";
  }
}

export interface VaultItemRecord {
  id: string;
  alias: string;
  origin: string;
  label: string;
  fields: VaultSecretField[];
  imap: ImapConfig | null;
}

export interface VaultItemListRow extends VaultItemRecord {
  hasImap: boolean;
  sessionSaved: boolean;
  createdAt: Date;
}

export interface SealedField {
  field: VaultSecretField;
  sealed: Uint8Array;
}

export interface VaultAuditInsert {
  workspaceId: string;
  itemId: string | null;
  alias: string;
  origin: string | null;
  field: string | null;
  action: VaultAuditAction;
  runId: string | null;
  approvedBy: string | null;
  outcome: string;
}

export interface VaultAuditListRow {
  id: string;
  alias: string;
  origin: string | null;
  field: string | null;
  action: VaultAuditAction;
  runId: string | null;
  approvedBy: string | null;
  outcome: string;
  at: Date;
}

export type SubmitOtpOutcome = "ok" | "not_found" | "finished";

const itemColumns = {
  id: vaultItems.id,
  alias: vaultItems.alias,
  origin: vaultItems.origin,
  label: vaultItems.label,
  fields: vaultItems.fields,
  imap: vaultItems.imap,
};

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
}

/* --------------------------------- reads ---------------------------------- */

/** The columns of a vault list row: the item plus whether mail settings and a session exist. */
const listRowColumns = {
  ...itemColumns,
  hasImap: sql<boolean>`${vaultItems.imap} is not null`,
  // Spelled out with table names: drizzle renders an interpolated column unqualified, which
  // inside this subquery would resolve to bs.* and match every session in the workspace.
  sessionSaved: sql<boolean>`exists (
    select 1 from browser_sessions bs
    where bs.workspace_id = vault_items.workspace_id
      and bs.alias = vault_items.alias
      and bs.origin = vault_items.origin)`,
  createdAt: vaultItems.createdAt,
};

export async function listVaultItems(
  db: Database,
  workspaceId: string,
): Promise<VaultItemListRow[]> {
  return db
    .select(listRowColumns)
    .from(vaultItems)
    .where(eq(vaultItems.workspaceId, workspaceId))
    .orderBy(vaultItems.alias);
}

/** One item's list row, or null when it is not in this workspace. */
export async function getVaultItemListRow(
  db: DbExecutor,
  workspaceId: string,
  itemId: string,
): Promise<VaultItemListRow | null> {
  const [row] = await db
    .select(listRowColumns)
    .from(vaultItems)
    .where(and(eq(vaultItems.workspaceId, workspaceId), eq(vaultItems.id, itemId)))
    .limit(1);
  return row ?? null;
}

export async function getVaultItem(
  db: DbExecutor,
  workspaceId: string,
  itemId: string,
): Promise<VaultItemRecord | null> {
  const [row] = await db
    .select(itemColumns)
    .from(vaultItems)
    .where(and(eq(vaultItems.workspaceId, workspaceId), eq(vaultItems.id, itemId)))
    .limit(1);
  return row ?? null;
}

export async function findVaultItemByAlias(
  db: DbExecutor,
  workspaceId: string,
  alias: string,
): Promise<VaultItemRecord | null> {
  const [row] = await db
    .select(itemColumns)
    .from(vaultItems)
    .where(and(eq(vaultItems.workspaceId, workspaceId), eq(vaultItems.alias, alias)))
    .limit(1);
  return row ?? null;
}

export async function listVaultItemRecords(
  db: DbExecutor,
  workspaceId: string,
): Promise<VaultItemRecord[]> {
  return db.select(itemColumns).from(vaultItems).where(eq(vaultItems.workspaceId, workspaceId));
}

/** Agent only: web_role has no SELECT on vault_secrets.sealed. */
export async function loadSealedSecret(
  db: DbExecutor,
  itemId: string,
  field: VaultSecretField,
): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ sealed: vaultSecrets.sealed })
    .from(vaultSecrets)
    .where(and(eq(vaultSecrets.itemId, itemId), eq(vaultSecrets.field, field)))
    .limit(1);
  return row?.sealed ?? null;
}

/* --------------------------------- writes --------------------------------- */

export async function appendVaultAudit(db: DbExecutor, row: VaultAuditInsert): Promise<void> {
  await db.insert(vaultAudit).values(row);
}

/**
 * Upserts one sealed field of an item in `workspaceId` and keeps vault_items.fields in sync
 * (review 9: never writes into another workspace's item). Needs no SELECT on sealed. Throws
 * VaultNotFound when the item is not in that workspace. Run it in a transaction with the caller's
 * other writes.
 */
export async function putVaultSecret(
  db: DbExecutor,
  item: { workspaceId: string; itemId: string },
  secret: SealedField,
): Promise<void> {
  const [owned] = await db
    .select({ id: vaultItems.id })
    .from(vaultItems)
    .where(and(eq(vaultItems.id, item.itemId), eq(vaultItems.workspaceId, item.workspaceId)))
    .limit(1);
  if (!owned) throw new VaultNotFound();
  const itemId = owned.id;
  const sealed = Buffer.from(secret.sealed);
  await db
    .insert(vaultSecrets)
    .values({ itemId, field: secret.field, sealed })
    .onConflictDoUpdate({
      target: [vaultSecrets.itemId, vaultSecrets.field],
      set: { sealed, updatedAt: sql`now()` },
    });
  await db
    .update(vaultItems)
    .set({
      fields: sql`(select coalesce(array_agg(distinct f order by f), '{}')
                   from unnest(array_append(${vaultItems.fields}, ${secret.field}::vault_secret_field)) as f)`,
      updatedAt: sql`now()`,
    })
    .where(eq(vaultItems.id, itemId));
}

export async function createVaultItem(
  db: Database,
  input: {
    workspaceId: string;
    alias: string;
    origin: string;
    label: string;
    imap: ImapConfig | null;
    secrets: readonly SealedField[];
    actor: string;
  },
): Promise<{ id: string; createdAt: Date }> {
  try {
    return await db.transaction(async (tx) => {
      const [item] = await tx
        .insert(vaultItems)
        .values({
          workspaceId: input.workspaceId,
          alias: input.alias,
          origin: input.origin,
          label: input.label,
          imap: input.imap,
          fields: input.secrets.map((secret) => secret.field),
        })
        .returning({ id: vaultItems.id, createdAt: vaultItems.createdAt });
      if (!item) throw new Error("vault item insert returned nothing");
      if (input.secrets.length > 0) {
        await tx.insert(vaultSecrets).values(
          input.secrets.map((secret) => ({
            itemId: item.id,
            field: secret.field,
            sealed: Buffer.from(secret.sealed),
          })),
        );
      }
      await appendVaultAudit(tx, {
        workspaceId: input.workspaceId,
        itemId: item.id,
        alias: input.alias,
        origin: input.origin,
        field: null,
        action: "create",
        runId: null,
        approvedBy: input.actor,
        outcome: "ok",
      });
      return item;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new VaultAliasTaken();
    throw error;
  }
}

export async function setVaultSecret(
  db: Database,
  input: { workspaceId: string; itemId: string; secret: SealedField; actor: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await getVaultItem(tx, input.workspaceId, input.itemId);
    if (!item) throw new VaultNotFound();
    await putVaultSecret(tx, { workspaceId: input.workspaceId, itemId: item.id }, input.secret);
    await appendVaultAudit(tx, {
      workspaceId: input.workspaceId,
      itemId: item.id,
      alias: item.alias,
      origin: item.origin,
      field: input.secret.field,
      action: "update",
      runId: null,
      approvedBy: input.actor,
      outcome: "set",
    });
  });
}

export async function removeVaultSecret(
  db: Database,
  input: { workspaceId: string; itemId: string; field: VaultSecretField; actor: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await getVaultItem(tx, input.workspaceId, input.itemId);
    if (!item) throw new VaultNotFound();
    await tx
      .delete(vaultSecrets)
      .where(and(eq(vaultSecrets.itemId, item.id), eq(vaultSecrets.field, input.field)));
    await tx
      .update(vaultItems)
      .set({
        fields: sql`array_remove(${vaultItems.fields}, ${input.field}::vault_secret_field)`,
        updatedAt: sql`now()`,
      })
      .where(eq(vaultItems.id, item.id));
    await appendVaultAudit(tx, {
      workspaceId: input.workspaceId,
      itemId: item.id,
      alias: item.alias,
      origin: item.origin,
      field: input.field,
      action: "update",
      runId: null,
      approvedBy: input.actor,
      outcome: "removed",
    });
  });
}

export async function deleteBrowserSessions(
  db: DbExecutor,
  input: { workspaceId: string; alias: string; origin: string | null },
): Promise<number> {
  const rows = await db
    .delete(browserSessions)
    .where(
      and(
        eq(browserSessions.workspaceId, input.workspaceId),
        eq(browserSessions.alias, input.alias),
        input.origin === null ? undefined : eq(browserSessions.origin, input.origin),
      ),
    )
    .returning({ id: browserSessions.id });
  return rows.length;
}

export async function deleteVaultItem(
  db: Database,
  input: { workspaceId: string; itemId: string; actor: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await getVaultItem(tx, input.workspaceId, input.itemId);
    if (!item) throw new VaultNotFound();
    await deleteBrowserSessions(tx, {
      workspaceId: input.workspaceId,
      alias: item.alias,
      origin: null,
    });
    await tx.delete(vaultItems).where(eq(vaultItems.id, item.id));
    await appendVaultAudit(tx, {
      workspaceId: input.workspaceId,
      itemId: item.id,
      alias: item.alias,
      origin: item.origin,
      field: null,
      action: "delete",
      runId: null,
      approvedBy: input.actor,
      outcome: "ok",
    });
  });
}

export async function forgetBrowserSession(
  db: Database,
  input: { workspaceId: string; alias: string; origin: string; actor: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await deleteBrowserSessions(tx, input);
    await appendVaultAudit(tx, {
      workspaceId: input.workspaceId,
      itemId: null,
      alias: input.alias,
      origin: input.origin,
      field: "session",
      action: "delete",
      runId: null,
      approvedBy: input.actor,
      outcome: removed > 0 ? "forgotten" : "none",
    });
  });
}

const AUDIT_CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([0-9a-f-]{36})$/;
const auditAtMs = sql`date_trunc('milliseconds', ${vaultAudit.at})`;

export async function listVaultAudit(
  db: Database,
  workspaceId: string,
  page: { limit: number; cursor: string | null },
): Promise<{ items: VaultAuditListRow[]; nextCursor: string | null }> {
  const match = page.cursor === null ? null : AUDIT_CURSOR.exec(page.cursor);
  // A cursor is either absent or exactly what nextCursor produced: a real instant and an id.
  if (
    page.cursor !== null &&
    (!match ||
      !Number.isFinite(Date.parse(match[1]!)) ||
      new Date(match[1]!).toISOString() !== match[1])
  )
    throw new VaultAuditCursorInvalid();
  const after = match
    ? sql`(${auditAtMs}, ${vaultAudit.id}) < (${match[1]!}::timestamptz, ${match[2]!}::uuid)`
    : undefined;
  const rows = await db
    .select({
      id: vaultAudit.id,
      alias: vaultAudit.alias,
      origin: vaultAudit.origin,
      field: vaultAudit.field,
      action: vaultAudit.action,
      runId: vaultAudit.runId,
      approvedBy: vaultAudit.approvedBy,
      outcome: vaultAudit.outcome,
      at: vaultAudit.at,
    })
    .from(vaultAudit)
    .where(and(eq(vaultAudit.workspaceId, workspaceId), after))
    .orderBy(desc(auditAtMs), desc(vaultAudit.id))
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > page.limit && last ? `${last.at.toISOString()}|${last.id}` : null,
  };
}

/* ----------------------------------- OTP ---------------------------------- */

/** web: store a sealed code, ask a waiting or sleeping run to wake, and NOTIFY otp_ready (spec §9). */
export async function submitOtpCode(
  db: Database,
  input: { workspaceId: string; runId: string; sealed: Uint8Array },
): Promise<SubmitOtpOutcome> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ status: runs.status })
      .from(runs)
      .where(and(eq(runs.id, input.runId), eq(runs.workspaceId, input.workspaceId)))
      .limit(1);
    if (!run) return "not_found";
    if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status)) return "finished";
    await tx.insert(otpCodes).values({ runId: input.runId, sealed: Buffer.from(input.sealed) });
    await tx
      .update(runs)
      .set({ wakeRequestedAt: sql`now()` })
      .where(and(eq(runs.id, input.runId), inArray(runs.status, ["waiting", "sleeping"])));
    await tx.execute(
      sql`select pg_notify('otp_ready', ${encodeNotify("otp_ready", { runId: input.runId })})`,
    );
    return "ok";
  });
}

/** agent: take the newest unexpired, unconsumed code for the run, exactly once. */
export async function consumeOtpCode(db: DbExecutor, runId: string): Promise<Uint8Array | null> {
  const [row] = await db
    .update(otpCodes)
    .set({ consumedAt: sql`now()` })
    .where(
      eq(
        otpCodes.id,
        sql`(select id from otp_codes
             where run_id = ${runId} and consumed_at is null and expires_at > now()
             order by created_at desc limit 1 for update skip locked)`,
      ),
    )
    .returning({ sealed: otpCodes.sealed });
  return row?.sealed ?? null;
}

/* --------------------------------- grants --------------------------------- */

export async function getVaultGrantApprover(
  db: DbExecutor,
  itemId: string,
  origin: string,
): Promise<string | null> {
  const [row] = await db
    .select({ approvedBy: vaultGrants.approvedBy })
    .from(vaultGrants)
    .where(and(eq(vaultGrants.itemId, itemId), eq(vaultGrants.origin, origin)))
    .limit(1);
  return row?.approvedBy ?? null;
}

export async function insertVaultGrant(
  db: DbExecutor,
  input: { itemId: string; origin: string; approvedBy: string },
): Promise<void> {
  await db.insert(vaultGrants).values(input).onConflictDoNothing();
}

/* -------------------------------- sessions -------------------------------- */

export async function upsertBrowserSession(
  db: DbExecutor,
  input: { workspaceId: string; alias: string; origin: string; sealed: Uint8Array },
): Promise<void> {
  const sealedState = Buffer.from(input.sealed);
  await db
    .insert(browserSessions)
    .values({
      workspaceId: input.workspaceId,
      alias: input.alias,
      origin: input.origin,
      sealedState,
    })
    .onConflictDoUpdate({
      target: [browserSessions.workspaceId, browserSessions.alias, browserSessions.origin],
      set: { sealedState, updatedAt: sql`now()` },
    });
}

/**
 * Sealed sessions for these origins whose alias a human approved on that origin (S11): a policy
 * (auto-mode) login never becomes a lasting signed-in state.
 */
export async function loadBrowserSessions(
  db: DbExecutor,
  workspaceId: string,
  origins: readonly string[],
): Promise<{ alias: string; origin: string; sealed: Uint8Array }[]> {
  if (origins.length === 0) return [];
  return db
    .select({
      alias: browserSessions.alias,
      origin: browserSessions.origin,
      sealed: browserSessions.sealedState,
    })
    .from(browserSessions)
    .innerJoin(
      vaultItems,
      and(
        eq(vaultItems.workspaceId, browserSessions.workspaceId),
        eq(vaultItems.alias, browserSessions.alias),
        eq(vaultItems.origin, browserSessions.origin),
      ),
    )
    .innerJoin(
      vaultGrants,
      and(
        eq(vaultGrants.itemId, vaultItems.id),
        eq(vaultGrants.origin, browserSessions.origin),
        ne(vaultGrants.approvedBy, POLICY_DECIDER),
      ),
    )
    .where(
      and(
        eq(browserSessions.workspaceId, workspaceId),
        inArray(browserSessions.origin, [...origins]),
      ),
    );
}

/** True when a person (not the auto-mode policy) granted this alias on this origin. */
export async function hasHumanVaultGrant(
  db: DbExecutor,
  input: { workspaceId: string; alias: string; origin: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: vaultGrants.id })
    .from(vaultGrants)
    .innerJoin(vaultItems, eq(vaultItems.id, vaultGrants.itemId))
    .where(
      and(
        eq(vaultItems.workspaceId, input.workspaceId),
        eq(vaultItems.alias, input.alias),
        eq(vaultItems.origin, input.origin),
        eq(vaultGrants.origin, input.origin),
        ne(vaultGrants.approvedBy, POLICY_DECIDER),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Aliases this run signed in with, so a restarted agent still checkpoints their sessions. */
export async function listRunCredentialUses(
  db: DbExecutor,
  runId: string,
): Promise<{ alias: string; origin: string }[]> {
  const rows = await db
    .selectDistinct({ alias: vaultAudit.alias, origin: vaultAudit.origin })
    .from(vaultAudit)
    .where(
      and(
        eq(vaultAudit.runId, runId),
        isNotNull(vaultAudit.origin),
        or(
          and(eq(vaultAudit.action, "fill"), eq(vaultAudit.outcome, "ok")),
          and(eq(vaultAudit.action, "passkey"), eq(vaultAudit.outcome, "asserted")),
        ),
      ),
    );
  return rows.flatMap((row) =>
    row.origin === null ? [] : [{ alias: row.alias, origin: row.origin }],
  );
}
