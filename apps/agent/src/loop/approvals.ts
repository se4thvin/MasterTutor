import { ApprovalEdit, ApprovalRequest, type ApprovalStatus } from "@mastertutor/contracts";
import { approvals, runEvents, runSteps, type Database } from "@mastertutor/db";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../runtime/types.ts";
import { CallResult } from "./call-result.ts";

/**
 * One approval covers one risky item of a model turn: a computer action (`<callId>#<index>`), a
 * call's safety checks (`<callId>#safety`) or a function call (`<callId>#fn`). Decisions already
 * made in the turn travel with the pending step so a restore keeps them.
 */
export const ItemDecision = z.object({
  item: z.string(),
  approved: z.boolean(),
  note: z.string().nullable(),
  /** The approved request's risk kind and label: an approved action runs only while these still match. */
  kind: z.string().nullable(),
  label: z.string().nullable(),
  /** The approved element's path (TargetDescription.path); null when the item has no element. */
  target: z.string().nullable().default(null),
  /** The approved element's record context digest (TargetDescription.context), R29-3. */
  context: z.string().nullable().default(null),
});
export type ItemDecision = z.infer<typeof ItemDecision>;

export const ApproveStepResult = z.object({
  approvalId: z.uuid(),
  callIds: z.array(z.string()),
  /** The risky item this approval is for; null for run-level approvals (budget, new origin). */
  item: z.string().nullable(),
  /** The element path of the item being asked about, bound into its decision. */
  target: z.string().nullable().default(null),
  /** The record context digest of that element. */
  context: z.string().nullable().default(null),
  url: z.string(),
  domHash: z.string(),
  decided: z.array(ItemDecision),
});
export type ApproveStepResult = z.infer<typeof ApproveStepResult>;
export interface PendingApproval extends ApproveStepResult {
  stepSeq: number;
  request: ApprovalRequest;
}

export const actionItem = (callId: string, index: number) => `${callId}#${index}`;
export const safetyItem = (callId: string) => `${callId}#safety`;
export const functionItem = (callId: string) => `${callId}#fn`;

export async function insertApprovals(
  tx: Tx,
  runId: string,
  stepSeq: number,
  rows: ReadonlyArray<{
    id: string;
    request: ApprovalRequest;
    status: "pending" | "approved" | "denied";
  }>,
  decidedBy: string | null,
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(approvals).values(
    rows.map((row) => ({
      id: row.id,
      runId,
      stepSeq,
      kind: row.request.kind,
      request: row.request,
      status: row.status,
      decidedBy: row.status === "pending" ? null : decidedBy,
      decidedAt: row.status === "pending" ? null : sql`now()`,
    })),
  );
}

export async function loadApprovalDecision(
  db: Database,
  id: string,
): Promise<{ status: ApprovalStatus; edit: ApprovalEdit | null } | null> {
  const [row] = await db
    .select({ status: approvals.status, edit: approvals.edit })
    .from(approvals)
    .where(eq(approvals.id, id));
  if (!row) return null;
  const edit = row.edit ? ApprovalEdit.safeParse(row.edit) : null;
  return { status: row.status, edit: edit?.success ? edit.data : null };
}

export async function markApprovalSuperseded(tx: Tx, id: string): Promise<void> {
  await tx
    .update(approvals)
    .set({ status: "superseded", decidedBy: "agent", decidedAt: sql`now()` })
    .where(
      and(
        eq(approvals.id, id),
        inArray(approvals.status, ["pending", "approved", "edited", "denied"]),
      ),
    );
}

/** The approve step still `started` is the one the run is waiting on. */
export async function loadPendingApproval(
  db: Database,
  runId: string,
): Promise<PendingApproval | null> {
  const [step] = await db
    .select({ seq: runSteps.seq, state: runSteps.state, result: runSteps.result })
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.phase, "approve")))
    .orderBy(desc(runSteps.seq))
    .limit(1);
  if (!step || step.state !== "started") return null;
  const parsed = ApproveStepResult.safeParse(step.result);
  if (!parsed.success) return null;
  const [row] = await db
    .select({ request: approvals.request })
    .from(approvals)
    .where(eq(approvals.id, parsed.data.approvalId));
  if (!row) return null;
  return { ...parsed.data, stepSeq: step.seq, request: ApprovalRequest.parse(row.request) };
}

export async function loadActResult(
  db: Database,
  runId: string,
  callId: string,
): Promise<CallResult | null> {
  const [row] = await db
    .select({ result: runSteps.result })
    .from(runSteps)
    .where(
      and(
        eq(runSteps.runId, runId),
        eq(runSteps.phase, "act"),
        eq(runSteps.state, "done"),
        sql`${runSteps.action}->>'callId' = ${callId}`,
      ),
    )
    .orderBy(desc(runSteps.seq))
    .limit(1);
  const parsed = CallResult.safeParse(row?.result);
  return parsed.success ? parsed.data : null;
}

export async function loadUserMessages(
  db: Database,
  runId: string,
  afterId: string | null,
): Promise<Array<{ id: string; text: string }>> {
  const rows = await db
    .select({ id: runEvents.id, payload: runEvents.payload })
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        eq(runEvents.type, "user_message"),
        afterId ? gt(runEvents.id, Number(afterId)) : undefined,
      ),
    )
    .orderBy(asc(runEvents.id));
  return rows.flatMap((row) =>
    row.payload.type === "user_message" ? [{ id: String(row.id), text: row.payload.text }] : [],
  );
}
