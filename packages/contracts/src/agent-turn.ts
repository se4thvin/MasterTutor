import { z } from "zod";
import { Plan } from "./budget.ts";
import { AgentTurnStatus, NeedHuman } from "./enums.ts";

/** Parsed with zodTextFormat from every model message (spec §5.3). Nullable, never optional. */
export const AgentTurn = z.object({
  status: AgentTurnStatus,
  needHuman: NeedHuman.nullable(),
  reason: z.string().max(2000),
  planUpdate: Plan.nullable(),
});
export type AgentTurn = z.infer<typeof AgentTurn>;

/** Context compaction summary (spec §5.4). */
export const CompactionSummary = z.object({
  goal: z.string().max(4000),
  plan: Plan,
  progress: z.string().max(8000),
  facts: z.array(z.string().max(1000)).max(100),
  openQuestions: z.array(z.string().max(1000)).max(50),
});
export type CompactionSummary = z.infer<typeof CompactionSummary>;

/** Auto-filing answer from gpt-6-luna (spec §7). At most one new leaf folder. */
export const FilingDecision = z.object({
  path: z.array(z.string().min(1).max(120)).min(1).max(8),
  createLeaf: z.boolean(),
});
export type FilingDecision = z.infer<typeof FilingDecision>;
