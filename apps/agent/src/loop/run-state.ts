import {
  TERMINAL_RUN_STATUSES,
  type ApprovalMode,
  type Budget,
  type Controller,
  type ObserverMode,
  type Plan,
  type RunStatus,
  type ToolProfile,
  type Usage,
  type WaitReason,
} from "@mastertutor/contracts";
import { emitRunEvent, runEvents, runSteps, runs, type Database, type DbTx } from "@mastertutor/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { RunRecord } from "./claim.ts";

export interface RunSnapshot {
  id: string;
  workspaceId: string;
  goal: string;
  /** The generated title; null while none is stored (the loop then asks for one). */
  title: string | null;
  model: string;
  approvalMode: ApprovalMode;
  /** Guard rollout (D52, spec §6.8). */
  observerMode: ObserverMode;
  toolProfile: ToolProfile;
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
    title: row.title ?? null,
    model: row.model,
    approvalMode: row.approvalMode,
    observerMode: row.observerMode,
    toolProfile: row.toolProfile,
    budget: row.budget,
    usage: row.usage,
    allowedOrigins: [...row.allowedOrigins],
    plan: row.plan ?? null,
    noteId: row.noteId ?? null,
  };
}

export interface RunControl {
  status: RunStatus;
  /** A person may change it mid-run (run-mode): the worker applies it before every step. */
  approvalMode: ApprovalMode;
  waitReason: WaitReason | null;
  controller: Controller;
  leaseOwner: string | null;
}

export async function readRunControl(db: Database, runId: string): Promise<RunControl | null> {
  const [row] = await db
    .select({
      status: runs.status,
      approvalMode: runs.approvalMode,
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

const SIGN_IN_PREFIX = "Sign-in needed for ";
const SIGN_IN_SUFFIX = " — add it in the Vault or take over";

/** The wait shown when a page wants a sign-in the vault cannot provide. */
export const signInNeeded = (origin: string) => `${SIGN_IN_PREFIX}${origin}${SIGN_IN_SUFFIX}`;

/**
 * Origins this run has already paused on for a sign-in, from its status events: it pauses at most
 * once per origin, so a restored or woken worker does not ask again.
 */
export async function signInPausedOrigins(db: Database, runId: string): Promise<Set<string>> {
  const rows = await db
    .select({ reason: sql<string | null>`${runEvents.payload}->>'reason'` })
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        eq(runEvents.type, "status"),
        sql`${runEvents.payload}->>'waitReason' = 'takeover'`,
        sql`starts_with(${runEvents.payload}->>'reason', ${SIGN_IN_PREFIX})`,
      ),
    );
  return new Set(
    rows.flatMap(({ reason }) =>
      reason?.endsWith(SIGN_IN_SUFFIX)
        ? [reason.slice(SIGN_IN_PREFIX.length, -SIGN_IN_SUFFIX.length)]
        : [],
    ),
  );
}

export const isTerminal = (status: RunStatus) =>
  (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);

/**
 * The pending wake request as exact database text (microseconds kept), or null. A step that
 * consumes it clears it only if no newer wake arrived (StepStore `consumeWake`).
 */
export async function readWakeRequest(db: Database, runId: string): Promise<string | null> {
  const [row] = await db
    .select({ at: sql<string | null>`${runs.wakeRequestedAt}::text` })
    .from(runs)
    .where(eq(runs.id, runId));
  return row?.at ?? null;
}

/** Writes the run's title once (a stored one is never replaced) and streams it in the same transaction. */
export async function storeRunTitle(tx: DbTx, runId: string, title: string): Promise<void> {
  const written = await tx
    .update(runs)
    .set({ title })
    .where(and(eq(runs.id, runId), isNull(runs.title)))
    .returning({ id: runs.id });
  if (written.length > 0) await emitRunEvent(tx, runId, { type: "title", title });
}
