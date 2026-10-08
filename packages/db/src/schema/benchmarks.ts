import { DEFAULT_BUDGET, type Budget } from "@mastertutor/contracts";
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, jsonbDefault, tstz, updatedAt } from "./columns.ts";
import { approvalModeEnum, benchmarkOutcomeEnum, toolProfileEnum } from "./enums.ts";
import { runs } from "./runs.ts";
import { workspaces } from "./workspace.ts";

/** A repeatable acceptance task, e.g. "complete the participation activities in readings 1-5 of a course site". */
export const benchmarks = pgTable(
  "benchmarks",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    task: text("task").notNull(),
    allowedOrigins: text("allowed_origins").array().notNull(),
    approvalMode: approvalModeEnum("approval_mode").notNull().default("auto_within_allowlist"),
    toolProfile: toolProfileEnum("tool_profile").notNull().default("browser_use"),
    budget: jsonb("budget").$type<Budget>().notNull().default(jsonbDefault(DEFAULT_BUDGET)),
    successCriteria: text("success_criteria").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("benchmarks_workspace_name_uq").on(t.workspaceId, t.name)],
);

/** One attempt: outcome, steps, cost and duration are snapshotted when the run finishes. */
export const benchmarkRuns = pgTable(
  "benchmark_runs",
  {
    id: id(),
    benchmarkId: uuid("benchmark_id")
      .notNull()
      .references(() => benchmarks.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .unique("benchmark_runs_run_uq")
      .references(() => runs.id, { onDelete: "set null" }),
    outcome: benchmarkOutcomeEnum("outcome").notNull().default("pending"),
    steps: integer("steps").notNull().default(0),
    usd: doublePrecision("usd").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    takeovers: integer("takeovers").notNull().default(0),
    durationMs: bigint("duration_ms", { mode: "number" }),
    failureNotes: text("failure_notes"),
    gradedBy: text("graded_by"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    finishedAt: tstz("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("benchmark_runs_benchmark_started_idx").on(t.benchmarkId, t.startedAt)],
);
