import {
  StepAction,
  fallbackRunTitle,
  type ApprovalView,
  type RunStepView,
  type RunSummary,
} from "@mastertutor/contracts";
import type { approvals, runSteps, runs } from "@mastertutor/db";

type RunRow = typeof runs.$inferSelect;
type ApprovalRow = typeof approvals.$inferSelect;
type StepRow = Pick<
  typeof runSteps.$inferSelect,
  "seq" | "phase" | "state" | "caption" | "url" | "screenshotKey" | "action" | "createdAt"
> & { reasoning: string | null };

/** DB rows to API views: one mapping each, shared by create-run.ts and service.ts. */
export function runSummaryOf(row: RunRow): RunSummary {
  return {
    id: row.id,
    goal: row.goal,
    // Existing runs (and runs whose title model failed) show the fallback: no backfill.
    title: row.title ?? fallbackRunTitle(row.goal),
    status: row.status,
    waitReason: row.waitReason,
    controller: row.controller,
    approvalMode: row.approvalMode,
    observerMode: row.observerMode,
    toolProfile: row.toolProfile,
    model: row.model,
    noteId: row.noteId,
    usage: row.usage,
    budget: row.budget,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function approvalViewOf(row: ApprovalRow): ApprovalView {
  return {
    id: row.id,
    runId: row.runId,
    stepSeq: row.stepSeq,
    kind: row.kind,
    request: row.request,
    status: row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** run_steps.action is the agent's StepAction plus its callId; the view keeps the contract fields only. */
export function stepViewOf(row: StepRow): RunStepView {
  const action = StepAction.safeParse(row.action);
  return {
    seq: row.seq,
    phase: row.phase,
    state: row.state,
    caption: row.caption,
    url: row.url,
    screenshotKey: row.screenshotKey,
    action: action.success ? action.data : null,
    reasoning: row.reasoning,
    createdAt: row.createdAt.toISOString(),
  };
}
