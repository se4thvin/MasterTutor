import {
  TERMINAL_RUN_STATUSES,
  type ApprovalMode,
  type Budget,
  type Controller,
  type Plan,
  type RunStatus,
  type Usage,
  type WaitReason,
} from "@mastertutor/contracts";
import { runSteps, runs, type Database } from "@mastertutor/db";
import { and, desc, eq } from "drizzle-orm";
import type { RunRecord } from "./claim.ts";

export interface RunSnapshot {
  id: string;
  workspaceId: string;
  goal: string;
  model: string;
  approvalMode: ApprovalMode;
  budget: Budget;
  usage: Usage;
  allowedOrigins: string[];
  plan: Plan | null;
  noteId: string | null;
}

export function snapshotOf(row: RunRecord): RunSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    goal: row.goal,
    model: row.model,
    approvalMode: row.approvalMode,
    budget: row.budget,
    usage: row.usage,
    allowedOrigins: [...row.allowedOrigins],
    plan: row.plan ?? null,
    noteId: row.noteId ?? null,
  };
}

export interface RunControl {
  status: RunStatus;
  waitReason: WaitReason | null;
  controller: Controller;
  leaseOwner: string | null;
}

export async function readRunControl(db: Database, runId: string): Promise<RunControl | null> {
  const [row] = await db
    .select({
      status: runs.status,
      waitReason: runs.waitReason,
      controller: runs.controller,
      leaseOwner: runs.leaseOwner,
    })
    .from(runs)
    .where(eq(runs.id, runId));
  return row ?? null;
}

/** Input tokens of the newest model turn, so a restored loop still compacts above the threshold. */
export async function lastInputTokens(db: Database, runId: string): Promise<number> {
  const [row] = await db
    .select({ usage: runSteps.usage })
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.phase, "decide")))
    .orderBy(desc(runSteps.seq))
    .limit(1);
  return row?.usage?.inputTokens ?? 0;
}

export const isTerminal = (status: RunStatus) =>
  (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
