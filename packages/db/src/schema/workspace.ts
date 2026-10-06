import { DEFAULT_BUDGET, DEFAULT_CONCURRENCY, type Budget } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id, jsonbDefault, updatedAt } from "./columns.ts";
import { memberRoleEnum } from "./enums.ts";

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("workspace_members_workspace_user_uq").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const settings = pgTable(
  "settings",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    killSwitch: boolean("kill_switch").notNull().default(false),
    defaultBudget: jsonb("default_budget")
      .$type<Budget>()
      .notNull()
      .default(jsonbDefault(DEFAULT_BUDGET)),
    defaultAllowedOrigins: text("default_allowed_origins")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    concurrency: integer("concurrency").notNull().default(DEFAULT_CONCURRENCY),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("settings_concurrency_positive", sql`${t.concurrency} >= 1`)],
);
