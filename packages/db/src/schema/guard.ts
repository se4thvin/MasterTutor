import type {
  GuardCategory,
  GuardInput,
  GuardStage,
  GuardVerdictName,
  ObserverMode,
} from "@mastertutor/contracts";
import { boolean, index, integer, jsonb, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.ts";
import { runRef } from "./runs.ts";

/**
 * One Guard review per triggered turn (spec §6.7, §9): its verdict, cost, the denial ledger after
 * it, and the metadata-only GuardInput (for benign replay). Written by the agent only.
 */
export const guardReviews = pgTable(
  "guard_reviews",
  {
    id: id(),
    runId: runRef(),
    stepSeq: integer("step_seq").notNull(),
    stage: text("stage").$type<GuardStage>().notNull(),
    verdict: text("verdict").$type<GuardVerdictName>().notNull(),
    category: text("category").$type<GuardCategory>().notNull(),
    rollout: text("rollout").$type<ObserverMode>().notNull(),
    applied: boolean("applied").notNull(),
    input: jsonb("input").$type<GuardInput>(),
    latencyMs: integer("latency_ms").notNull(),
    usd: numeric("usd", { precision: 12, scale: 6, mode: "number" }).notNull(),
    consecutive: integer("consecutive").notNull(),
    total: integer("total").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("guard_reviews_run_idx").on(t.runId, t.createdAt)],
);
