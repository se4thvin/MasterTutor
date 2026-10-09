import type {
  AlertRule,
  CopilotToolName,
  GuardCategory,
  GuardStage,
  GuardVerdictName,
  ObserverMode,
  Usage,
} from "@mastertutor/contracts";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tstz, updatedAt } from "./columns.ts";
import {
  approvalKindEnum,
  approvalModeEnum,
  approvalStatusEnum,
  controllerEnum,
  observerModeEnum,
  runStatusEnum,
  stepPhaseEnum,
  stepStateEnum,
  toolProfileEnum,
  waitReasonEnum,
} from "./enums.ts";

/**
 * The Copilot's whole world (spec §7.3): views over public tables (created by hand in 0015, typed
 * here with .existing()) and its own replay tables. observer_role has no grant anywhere else.
 */
export const observerSchema = pgSchema("observer");

/* --- the Copilot's own tables (drizzle generates these) --- */

export const copilotThreads = observerSchema.table(
  "copilot_threads",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: text("created_by").notNull(),
    title: text("title").notNull(),
    /** HandleMap.toJSON(): handle → run id, per thread (spec §7.5). */
    handles: jsonb("handles").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("copilot_threads_ws_idx").on(t.workspaceId, t.updatedAt)],
);

export const copilotItems = observerSchema.table(
  "copilot_items",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => copilotThreads.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").$type<"user" | "assistant" | "tool">().notNull(),
    item: jsonb("item").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.seq] })],
);

export const copilotResults = observerSchema.table(
  "copilot_results",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => copilotThreads.id, { onDelete: "cascade" }),
    resultId: text("result_id").notNull(),
    tool: text("tool").$type<CopilotToolName>().notNull(),
    summary: text("summary").notNull(),
    query: jsonb("query").$type<Record<string, unknown>>().notNull(),
    columns: jsonb("columns").$type<string[]>().notNull(),
    rows: jsonb("rows").$type<Array<Array<string | number | boolean | null>>>().notNull(),
    rowCount: integer("row_count").notNull(),
    truncated: boolean("truncated").notNull(),
    tookMs: integer("took_ms").notNull(),
    tainted: boolean("tainted").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.resultId] })],
);

export const copilotSpend = observerSchema.table("copilot_spend", {
  day: date("day", { mode: "string" }).primaryKey(),
  usd: numeric("usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
});

/* --- read-only views (0015 creates them; listed columns only, security_barrier) --- */

export const observerRuns = observerSchema
  .view("runs", {
    id: uuid("id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    status: runStatusEnum("status").notNull(),
    waitReason: waitReasonEnum("wait_reason"),
    controller: controllerEnum("controller").notNull(),
    approvalMode: approvalModeEnum("approval_mode").notNull(),
    observerMode: observerModeEnum("observer_mode").notNull(),
    toolProfile: toolProfileEnum("tool_profile").notNull(),
    model: text("model").notNull(),
    budget: jsonb("budget").notNull(),
    usage: jsonb("usage").$type<Usage>().notNull(),
    errorCode: text("error_code"),
    title: text("title"),
    createdAt: tstz("created_at").notNull(),
    finishedAt: tstz("finished_at"),
    lastActivityAt: tstz("last_activity_at"),
  })
  .existing();

export const observerRunGoals = observerSchema
  .view("run_goals", {
    id: uuid("id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    goal: text("goal").notNull(),
  })
  .existing();

export const observerRunSteps = observerSchema
  .view("run_steps", {
    runId: uuid("run_id").notNull(),
    seq: integer("seq").notNull(),
    phase: stepPhaseEnum("phase").notNull(),
    state: stepStateEnum("state").notNull(),
    tool: text("tool"),
    origin: text("origin"),
    caption: text("caption"),
    usage: jsonb("usage").$type<Usage>(),
    createdAt: tstz("created_at").notNull(),
  })
  .existing();

export const observerApprovals = observerSchema
  .view("approvals", {
    id: uuid("id").notNull(),
    runId: uuid("run_id").notNull(),
    stepSeq: integer("step_seq").notNull(),
    kind: approvalKindEnum("kind").notNull(),
    status: approvalStatusEnum("status").notNull(),
    decider: text("decider"),
    decidedAt: tstz("decided_at"),
    createdAt: tstz("created_at").notNull(),
  })
  .existing();

export const observerRunEvents = observerSchema
  .view("run_events", {
    id: bigint("id", { mode: "number" }).notNull(),
    runId: uuid("run_id").notNull(),
    type: text("type").notNull(),
    guardVerdict: text("guard_verdict").$type<GuardVerdictName>(),
    guardCategory: text("guard_category").$type<GuardCategory>(),
    createdAt: tstz("created_at").notNull(),
  })
  .existing();

export const observerGuardReviews = observerSchema
  .view("guard_reviews", {
    runId: uuid("run_id").notNull(),
    stepSeq: integer("step_seq").notNull(),
    stage: text("stage").$type<GuardStage>().notNull(),
    verdict: text("verdict").$type<GuardVerdictName>().notNull(),
    category: text("category").$type<GuardCategory>().notNull(),
    rollout: text("rollout").$type<ObserverMode>().notNull(),
    applied: boolean("applied").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    usd: numeric("usd", { precision: 12, scale: 6, mode: "number" }).notNull(),
    createdAt: tstz("created_at").notNull(),
  })
  .existing();

export const observerAlerts = observerSchema
  .view("alerts", {
    id: uuid("id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    rule: text("rule").$type<AlertRule>().notNull(),
    firedAt: tstz("fired_at").notNull(),
    acknowledgedAt: tstz("acknowledged_at"),
  })
  .existing();
