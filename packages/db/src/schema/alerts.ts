import { ALERT_RULES, type AlertRule } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id, tstz } from "./columns.ts";
import { workspaces } from "./workspace.ts";

/** Alerts from OpenObserve (spec §13.3): the rule and when, never alert content. */
export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rule: text("rule").$type<AlertRule>().notNull(),
    firedAt: tstz("fired_at").notNull().defaultNow(),
    acknowledgedAt: tstz("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("alerts_workspace_fired_idx").on(t.workspaceId, t.firedAt),
    check("alerts_rule_ck", sql.raw(`rule in (${ALERT_RULES.map((r) => `'${r}'`).join(", ")})`)),
  ],
);

/** Web Push subscriptions (spec §13.4): the browser's endpoint and keys, per user. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique("push_subscriptions_endpoint_uq"),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);
