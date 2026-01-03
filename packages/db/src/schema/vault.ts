import type { ImapConfig } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, id, tstz, updatedAt } from "./columns.ts";
import { vaultAuditActionEnum, vaultSecretFieldEnum } from "./enums.ts";
import { runs } from "./runs.ts";
import { workspaces } from "./workspace.ts";

export const vaultItems = pgTable(
  "vault_items",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    origin: text("origin").notNull(),
    label: text("label").notNull(),
    fields: vaultSecretFieldEnum("fields")
      .array()
      .notNull()
      .default(sql`'{}'`),
    imap: jsonb("imap").$type<ImapConfig>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("vault_items_workspace_alias_uq").on(t.workspaceId, t.alias),
    check("vault_items_alias_valid", sql`${t.alias} ~ '^[a-z0-9][a-z0-9_-]{0,62}$'`),
  ],
);

const itemRef = () =>
  uuid("item_id")
    .notNull()
    .references(() => vaultItems.id, { onDelete: "cascade" });

export const vaultSecrets = pgTable(
  "vault_secrets",
  {
    id: id(),
    itemId: itemRef(),
    field: vaultSecretFieldEnum("field").notNull(),
    sealed: bytea("sealed").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("vault_secrets_item_field_uq").on(t.itemId, t.field)],
);

export const vaultGrants = pgTable(
  "vault_grants",
  {
    id: id(),
    itemId: itemRef(),
    origin: text("origin").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: tstz("approved_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [unique("vault_grants_item_origin_uq").on(t.itemId, t.origin)],
);

export const otpCodes = pgTable("otp_codes", {
  id: id(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => vaultItems.id, { onDelete: "cascade" }),
  sealed: bytea("sealed").notNull(),
  expiresAt: tstz("expires_at")
    .notNull()
    .default(sql`now() + interval '5 minutes'`),
  consumedAt: tstz("consumed_at"),
  createdAt: createdAt(),
});

export const browserSessions = pgTable(
  "browser_sessions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    origin: text("origin").notNull(),
    sealedState: bytea("sealed_state").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("browser_sessions_workspace_alias_origin_uq").on(t.workspaceId, t.alias, t.origin),
  ],
);

/** Append-only (grants + trigger in migration 0002). No FKs, so deletes elsewhere never touch it. */
export const vaultAudit = pgTable(
  "vault_audit",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    itemId: uuid("item_id"),
    alias: text("alias").notNull(),
    origin: text("origin"),
    field: text("field"),
    action: vaultAuditActionEnum("action").notNull(),
    runId: uuid("run_id"),
    approvedBy: text("approved_by"),
    outcome: text("outcome").notNull(),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [index("vault_audit_workspace_at_idx").on(t.workspaceId, t.at)],
);
