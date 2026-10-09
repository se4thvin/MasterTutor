import type { AlertRule, RunStatus } from "@mastertutor/contracts";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { DbLike } from "../client.ts";
import {
  observerAlerts,
  observerApprovals,
  observerGuardReviews,
  observerRunEvents,
  observerRunGoals,
  observerRunSteps,
  observerRuns,
} from "../schema/observer.ts";

export interface RunFilter {
  status: RunStatus | null;
  errorCode: string | null;
  sinceHours: number;
  limit: number;
}
export type ObserverRunRow = typeof observerRuns.$inferSelect;

/** At most 90 days back (spec §7.5, runs_find sinceHours ≤ 2160). */
const hoursAgo = (hours: number) =>
  sql`now() - make_interval(hours => ${Math.max(1, Math.min(Math.trunc(hours), 2_160))})`;

/** Fixed, parameterised: the model never writes SQL against Postgres (spec §7.4). */
export async function findRuns(
  db: DbLike,
  workspaceId: string,
  filter: RunFilter,
): Promise<ObserverRunRow[]> {
  return db
    .select()
    .from(observerRuns)
    .where(
      and(
        eq(observerRuns.workspaceId, workspaceId),
        filter.status ? eq(observerRuns.status, filter.status) : undefined,
        filter.errorCode ? eq(observerRuns.errorCode, filter.errorCode) : undefined,
        gt(observerRuns.createdAt, hoursAgo(filter.sinceHours)),
      ),
    )
    .orderBy(desc(observerRuns.createdAt))
    .limit(Math.max(1, Math.min(filter.limit, 50)));
}

export interface RunDetail {
  run: ObserverRunRow;
  /** Only on the per-question opt-in (D52); otherwise null. */
  goal: string | null;
  steps: Array<{
    seq: number;
    phase: string;
    state: string;
    tool: string | null;
    origin: string | null;
    caption: string | null;
  }>;
  approvals: Array<{ stepSeq: number; kind: string; status: string; decider: string | null }>;
  events: Array<{
    type: string;
    guardVerdict: string | null;
    guardCategory: string | null;
    at: Date;
  }>;
  guard: Array<{
    stepSeq: number;
    stage: string;
    verdict: string;
    category: string;
    applied: boolean;
    latencyMs: number;
  }>;
}

const MAX_STEPS = 200;

export async function runDetail(
  db: DbLike,
  workspaceId: string,
  runId: string,
  options: { includeUntrusted: boolean },
): Promise<RunDetail | null> {
  const [run] = await db
    .select()
    .from(observerRuns)
    .where(and(eq(observerRuns.id, runId), eq(observerRuns.workspaceId, workspaceId)));
  if (!run) return null;
  const [goalRow, steps, approvals, events, guard] = await Promise.all([
    options.includeUntrusted
      ? db
          .select({ goal: observerRunGoals.goal })
          .from(observerRunGoals)
          .where(eq(observerRunGoals.id, runId))
      : Promise.resolve([]),
    db
      .select()
      .from(observerRunSteps)
      .where(eq(observerRunSteps.runId, runId))
      .orderBy(asc(observerRunSteps.seq))
      .limit(MAX_STEPS),
    db
      .select()
      .from(observerApprovals)
      .where(eq(observerApprovals.runId, runId))
      .orderBy(asc(observerApprovals.createdAt)),
    db
      .select()
      .from(observerRunEvents)
      .where(eq(observerRunEvents.runId, runId))
      .orderBy(asc(observerRunEvents.id))
      .limit(500),
    db
      .select()
      .from(observerGuardReviews)
      .where(eq(observerGuardReviews.runId, runId))
      .orderBy(asc(observerGuardReviews.createdAt)),
  ]);
  return {
    run,
    goal: goalRow[0]?.goal ?? null,
    steps: steps.map((step) => ({
      seq: step.seq,
      phase: step.phase,
      state: step.state,
      tool: step.tool,
      origin: options.includeUntrusted ? step.origin : null,
      caption: options.includeUntrusted ? step.caption : null,
    })),
    approvals: approvals.map((a) => ({
      stepSeq: a.stepSeq,
      kind: a.kind,
      status: a.status,
      decider: a.decider,
    })),
    events: events.map((e) => ({
      type: e.type,
      guardVerdict: e.guardVerdict,
      guardCategory: e.guardCategory,
      at: e.createdAt,
    })),
    guard: guard.map((g) => ({
      stepSeq: g.stepSeq,
      stage: g.stage,
      verdict: g.verdict,
      category: g.category,
      applied: g.applied,
      latencyMs: g.latencyMs,
    })),
  };
}

/** "Why did this fire?": the rule and time only (spec §7.10). */
export async function alertForCopilot(
  db: DbLike,
  workspaceId: string,
  alertId: string,
): Promise<{ rule: AlertRule; firedAt: Date } | null> {
  const [row] = await db
    .select({ rule: observerAlerts.rule, firedAt: observerAlerts.firedAt })
    .from(observerAlerts)
    .where(and(eq(observerAlerts.id, alertId), eq(observerAlerts.workspaceId, workspaceId)));
  return row ?? null;
}
