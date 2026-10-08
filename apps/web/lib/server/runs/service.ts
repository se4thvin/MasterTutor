import {
  TERMINAL_RUN_STATUSES,
  UserId,
  isPersonDecider,
  type ApprovalDecisionInput,
  type ApprovalEdit,
  type ListRunStepsInput,
  type ListRunsInput,
  type RunDetail,
  type RunStatus,
  type RunStepView,
  type RunSummary,
  type SendMessageInput,
} from "@mastertutor/contracts";
import {
  KeysetCursorInvalid,
  approvals,
  emitRunEvent,
  heldDownloads,
  storedDownloads,
  keysetBefore,
  keysetCursor,
  msOf,
  notifyRunControl,
  notifyRunWake,
  parseKeysetCursor,
  runEvents,
  runSteps,
  runs,
  type Database,
  type DbTx,
  type KeysetPosition,
} from "@mastertutor/db";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { safeFilename } from "@mastertutor/storage";
import { ServiceError } from "../service-error.ts";
import type { RunScope } from "./create-run.ts";
import { RUN_MESSAGES } from "./messages.ts";
import { approvalViewOf, runSummaryOf, stepViewOf } from "./views.ts";

const TERMINAL: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);
const missingRun = () => new ServiceError("not_found", "That run doesn't exist.");
const finishedRun = () => new ServiceError("conflict", RUN_MESSAGES.runFinished);
const inScope = (scope: RunScope, runId: string) =>
  and(eq(runs.id, runId), eq(runs.workspaceId, scope.workspaceId));

/**
 * Locks the run row for the rest of the transaction. Every writer of run_events locks the run
 * first (the agent's step commit updates it, B6's control writes lock it), so a run's event ids
 * commit in id order and the SSE cursor (`id > after`) never skips one.
 */
async function lockRun(tx: DbTx, scope: RunScope, runId: string): Promise<{ status: RunStatus }> {
  const [row] = await tx
    .select({ status: runs.status })
    .from(runs)
    .where(inScope(scope, runId))
    .for("update");
  if (!row) throw missingRun();
  return row;
}

export async function listRuns(
  db: Database,
  scope: RunScope,
  input: ListRunsInput,
): Promise<{ items: RunSummary[]; nextCursor: string | null }> {
  let position: KeysetPosition | null;
  try {
    position = parseKeysetCursor(input.cursor);
  } catch (error) {
    if (error instanceof KeysetCursorInvalid)
      throw new ServiceError("invalid", "That page of runs doesn't exist.");
    throw error;
  }
  const rows = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, scope.workspaceId),
        input.status === null ? undefined : eq(runs.status, input.status),
        keysetBefore(runs.createdAt, runs.id, position),
      ),
    )
    .orderBy(desc(msOf(runs.createdAt)), desc(runs.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items: items.map(runSummaryOf),
    nextCursor: rows.length > input.limit && last ? keysetCursor(last.createdAt, last.id) : null,
  };
}

/**
 * The run snapshot. lastEventId is read FIRST: an event committed between the two reads is then
 * replayed by SSE (and applied idempotently by the client) instead of being skipped.
 */
export async function getRun(db: Database, scope: RunScope, runId: string): Promise<RunDetail> {
  const [last] = await db
    .select({ id: sql<string | null>`max(${runEvents.id})::text` })
    .from(runEvents)
    .where(eq(runEvents.runId, runId));
  const [row] = await db.select().from(runs).where(inScope(scope, runId));
  if (!row) throw missingRun();
  const pending = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")))
    .orderBy(asc(approvals.createdAt));
  const where = { runId, workspaceId: scope.workspaceId };
  const [held, stored] = await Promise.all([heldDownloads(db, where), storedDownloads(db, where)]);
  return {
    ...runSummaryOf(row),
    plan: row.plan ?? null,
    allowedOrigins: row.allowedOrigins,
    currentUrl: row.currentUrl,
    slotName: row.slotName,
    targetFolderId: row.targetFolderId,
    pendingApprovals: pending.map(approvalViewOf),
    // Stored already cleaned by the agent; cleaned again here, since the name is page-derived.
    heldDownloads: held.map((d) => ({ ...d, filename: safeFilename(d.filename) })),
    downloads: stored.map((d) => ({
      ...d,
      filename: safeFilename(d.filename),
      at: d.at.toISOString(),
    })),
    lastEventId: last?.id ?? null,
  };
}

export async function listRunSteps(
  db: Database,
  scope: RunScope,
  input: ListRunStepsInput,
): Promise<{ items: RunStepView[] }> {
  const [run] = await db.select({ id: runs.id }).from(runs).where(inScope(scope, input.runId));
  if (!run) throw missingRun();
  const rows = await db
    .select({
      seq: runSteps.seq,
      phase: runSteps.phase,
      state: runSteps.state,
      caption: runSteps.caption,
      url: runSteps.url,
      screenshotKey: runSteps.screenshotKey,
      action: runSteps.action,
      createdAt: runSteps.createdAt,
    })
    .from(runSteps)
    .where(
      and(
        eq(runSteps.runId, input.runId),
        input.afterSeq === null ? undefined : gt(runSteps.seq, input.afterSeq),
      ),
    )
    .orderBy(asc(runSteps.seq))
    .limit(input.limit);
  return { items: rows.map(stepViewOf) };
}

/**
 * Spec §5.1: any non-terminal state → cancelled. A pending approval is superseded by the person
 * who cancelled; NOTIFY run_control makes the worker abort and free its slot (worker.ts M7).
 * Cancelling a cancelled run is ok; a completed or failed one is a conflict.
 */
export async function cancelRun(db: Database, scope: RunScope, runId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const run = await lockRun(tx, scope, runId);
    if (run.status === "cancelled") return;
    if (TERMINAL.has(run.status)) throw finishedRun();
    await tx
      .update(runs)
      .set({
        status: "cancelled",
        waitReason: null,
        controller: "agent",
        controlUserId: null,
        wakeRequestedAt: null,
        finishedAt: sql`now()`,
      })
      .where(eq(runs.id, runId));
    const superseded = await tx
      .update(approvals)
      .set({ status: "superseded", decidedBy: scope.actor, decidedAt: sql`now()` })
      .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")))
      .returning({ id: approvals.id });
    for (const { id } of superseded)
      await emitRunEvent(tx, runId, {
        type: "approval_resolved",
        approvalId: id,
        status: "superseded",
        decidedBy: scope.actor,
      });
    await emitRunEvent(tx, runId, {
      type: "status",
      status: "cancelled",
      waitReason: null,
      reason: "cancelled by the user",
    });
    await notifyRunControl(tx, runId);
  });
}

/** Spec §5.4 wake trigger "Resume": a sleeping run asks for a slot; any live run re-reads itself. */
export async function resumeRun(db: Database, scope: RunScope, runId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const run = await lockRun(tx, scope, runId);
    if (TERMINAL.has(run.status)) throw finishedRun();
    if (run.status === "sleeping")
      await tx
        .update(runs)
        .set({ wakeRequestedAt: sql`now()` })
        .where(eq(runs.id, runId));
    await notifyRunWake(tx, runId, "resume");
  });
}

/** A user message is a run event the agent reads (loadUserMessages) plus a wake (spec §5.4). */
export async function sendRunMessage(
  db: Database,
  scope: RunScope,
  input: SendMessageInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const run = await lockRun(tx, scope, input.runId);
    if (TERMINAL.has(run.status)) throw finishedRun();
    await emitRunEvent(tx, input.runId, { type: "user_message", text: input.text });
    if (run.status === "sleeping")
      await tx
        .update(runs)
        .set({ wakeRequestedAt: sql`now()` })
        .where(eq(runs.id, input.runId));
    await notifyRunWake(tx, input.runId, "message");
  });
}

/**
 * A person's decision (D11: decidedBy is the viewer's id, so the timeline says "You" only on a
 * match). The agent reads the row on wake (loadApprovalDecision); web emits approval_resolved
 * because the agent emits it only for policy and superseded decisions. A budget choice is valid
 * only on a budget approval. Lock order: run row, then approval row.
 */
export async function decideRunApproval(
  db: Database,
  scope: RunScope,
  input: ApprovalDecisionInput,
): Promise<void> {
  if (!UserId.safeParse(scope.actor).success || !isPersonDecider(scope.actor))
    throw new ServiceError("forbidden", "Only a person can decide an approval.");
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ runId: approvals.runId })
      .from(approvals)
      .innerJoin(runs, eq(runs.id, approvals.runId))
      .where(and(eq(approvals.id, input.approvalId), eq(runs.workspaceId, scope.workspaceId)));
    if (!target) throw new ServiceError("not_found", "That approval doesn't exist.");
    const run = await lockRun(tx, scope, target.runId);
    const [approval] = await tx
      .select({ status: approvals.status, kind: approvals.kind })
      .from(approvals)
      .where(eq(approvals.id, input.approvalId))
      .for("update");
    if (!approval || approval.status !== "pending")
      throw new ServiceError("conflict", RUN_MESSAGES.approvalDecided);
    if (TERMINAL.has(run.status)) throw finishedRun();
    if (input.budgetChoice !== null && approval.kind !== "budget")
      throw new ServiceError("invalid", "Only a budget approval takes a budget choice.");
    const edit: ApprovalEdit | null =
      input.instruction !== null || input.budgetChoice !== null
        ? { instruction: input.instruction, budgetChoice: input.budgetChoice }
        : null;
    await tx
      .update(approvals)
      .set({ status: input.decision, edit, decidedBy: scope.actor, decidedAt: sql`now()` })
      .where(eq(approvals.id, input.approvalId));
    await emitRunEvent(tx, target.runId, {
      type: "approval_resolved",
      approvalId: input.approvalId,
      status: input.decision,
      decidedBy: scope.actor,
    });
    await tx
      .update(runs)
      .set({ wakeRequestedAt: sql`now()` })
      .where(and(eq(runs.id, target.runId), inArray(runs.status, ["waiting", "sleeping"])));
    await notifyRunWake(tx, target.runId, "approval");
  });
}
