import {
  CreateRunInput,
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  TERMINAL_RUN_STATUSES,
  type BenchmarkOutcome,
  type BenchmarkRunView,
  type BenchmarkView,
  type CreateBenchmarkInput,
  type GradeBenchmarkRunInput,
  type ListBenchmarkRunsInput,
  type RunSummary,
  type StartBenchmarkResult,
} from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { benchmarkRuns, benchmarks, runEvents, runs, type Database } from "@mastertutor/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRun } from "../runs/create-run.ts";

const log = createLogger({ service: "web" });

export class BenchmarkNotFound extends Error {
  constructor() {
    super("Benchmark not found");
    this.name = "BenchmarkNotFound";
  }
}
export class BenchmarkNameTaken extends Error {
  constructor() {
    super("A benchmark with this name already exists");
    this.name = "BenchmarkNameTaken";
  }
}
export class BenchmarkRunNotFinished extends Error {
  constructor() {
    super("The run has not finished; grade it after it completes, fails or is cancelled");
    this.name = "BenchmarkRunNotFinished";
  }
}

export interface BenchmarkScope {
  workspaceId: string;
  actor: string;
}
export type CreateRunFn = (
  db: Database,
  scope: BenchmarkScope,
  input: CreateRunInput,
) => Promise<RunSummary>;

/** Drizzle's transaction has the same query API as the database; nested transactions are savepoints. */
const inTx = (tx: unknown) => tx as Database;
const iso = (date: Date | null) => (date === null ? null : date.toISOString());

function toView(row: typeof benchmarks.$inferSelect): BenchmarkView {
  return {
    id: row.id,
    name: row.name,
    task: row.task,
    allowedOrigins: row.allowedOrigins,
    approvalMode: row.approvalMode,
    toolProfile: row.toolProfile,
    budget: row.budget,
    successCriteria: row.successCriteria,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createBenchmark(
  db: Database,
  workspaceId: string,
  input: CreateBenchmarkInput,
): Promise<BenchmarkView> {
  const [row] = await db
    .insert(benchmarks)
    .values({
      workspaceId,
      name: input.name,
      task: input.task,
      allowedOrigins: input.allowedOrigins,
      approvalMode: input.approvalMode,
      toolProfile: input.toolProfile,
      budget: input.budget ?? DEFAULT_BUDGET,
      successCriteria: input.successCriteria,
    })
    .onConflictDoNothing({ target: [benchmarks.workspaceId, benchmarks.name] })
    .returning();
  if (!row) throw new BenchmarkNameTaken();
  return toView(row);
}

export async function listBenchmarks(db: Database, workspaceId: string): Promise<BenchmarkView[]> {
  const rows = await db
    .select()
    .from(benchmarks)
    .where(eq(benchmarks.workspaceId, workspaceId))
    .orderBy(desc(benchmarks.createdAt));
  return rows.map(toView);
}

/**
 * One transaction: the run (Task 0's createRun, whose NOTIFY run_queued is delivered on commit) and
 * its attempt row, so a failed create leaves nothing behind. A bypass benchmark was accepted only
 * with the acknowledgement (the contract's refine), so its runs carry it (D44, P10a-15).
 */
export async function startBenchmark(
  db: Database,
  scope: BenchmarkScope,
  benchmarkId: string,
  create: CreateRunFn = createRun,
): Promise<StartBenchmarkResult> {
  return db.transaction(async (tx) => {
    const [benchmark] = await tx
      .select()
      .from(benchmarks)
      .where(and(eq(benchmarks.id, benchmarkId), eq(benchmarks.workspaceId, scope.workspaceId)));
    if (!benchmark) throw new BenchmarkNotFound();
    const bypass = benchmark.approvalMode === "bypass";
    const runInput = CreateRunInput.parse({
      goal: benchmark.task,
      allowedOrigins: benchmark.allowedOrigins,
      budget: benchmark.budget,
      targetFolderId: null,
      approvalMode: benchmark.approvalMode,
      toolProfile: benchmark.toolProfile,
      ...(bypass ? { bypassAcknowledged: true as const } : {}),
    });
    const run = await create(inTx(tx), scope, runInput);
    const [attempt] = await tx
      .insert(benchmarkRuns)
      .values({ benchmarkId, runId: run.id })
      .returning({ id: benchmarkRuns.id });
    if (bypass)
      log.info(
        { benchmarkId, runId: run.id, actor: scope.actor, approvalMode: "bypass" },
        "benchmark run started in bypass mode (acknowledged when the benchmark was created)",
      );
    return { benchmarkRunId: attempt!.id, runId: run.id };
  });
}

/** Takeovers: control events that handed the page to a person. */
const takeoversOf = sql<number>`(select count(*)::int from ${runEvents} e
  where e.run_id = ${benchmarkRuns.runId} and e.type = 'control' and e.payload->>'holder' = 'user')`;

function selectRuns(db: Database) {
  return db
    .select({
      attempt: benchmarkRuns,
      usage: runs.usage,
      status: runs.status,
      runFinishedAt: runs.finishedAt,
      takeovers: takeoversOf,
    })
    .from(benchmarkRuns)
    .innerJoin(benchmarks, eq(benchmarks.id, benchmarkRuns.benchmarkId))
    .leftJoin(runs, eq(runs.id, benchmarkRuns.runId));
}
type JoinedRun = Awaited<ReturnType<ReturnType<typeof selectRuns>["where"]>>[number];

function durationMs(startedAt: Date, finishedAt: Date | null): number | null {
  return finishedAt === null ? null : Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

/** Pending attempts show live metrics from the run; graded ones show their snapshot. */
function toRunView(row: JoinedRun): BenchmarkRunView {
  const a = row.attempt;
  const live = a.outcome === "pending";
  const usage = row.usage ?? EMPTY_USAGE;
  return {
    id: a.id,
    benchmarkId: a.benchmarkId,
    runId: a.runId,
    outcome: a.outcome,
    steps: live ? usage.steps : a.steps,
    usd: live ? usage.usd : a.usd,
    inputTokens: live ? usage.inputTokens : a.inputTokens,
    outputTokens: live ? usage.outputTokens : a.outputTokens,
    durationMs: live ? durationMs(a.startedAt, row.runFinishedAt) : a.durationMs,
    takeovers: live ? row.takeovers : a.takeovers,
    failureNotes: a.failureNotes,
    gradedBy: a.gradedBy,
    startedAt: a.startedAt.toISOString(),
    finishedAt: live ? iso(row.runFinishedAt) : iso(a.finishedAt),
  };
}

export async function listBenchmarkRuns(
  db: Database,
  workspaceId: string,
  input: ListBenchmarkRunsInput,
): Promise<BenchmarkRunView[]> {
  const rows = await selectRuns(db)
    .where(
      and(
        eq(benchmarks.workspaceId, workspaceId),
        input.benchmarkId === null ? undefined : eq(benchmarkRuns.benchmarkId, input.benchmarkId),
      ),
    )
    .orderBy(desc(benchmarkRuns.startedAt))
    .limit(input.limit);
  return rows.map(toRunView);
}

/** A takeover is a failure for benchmarking: it caps a pass at partial (P10a-13). */
function cappedOutcome(outcome: Exclude<BenchmarkOutcome, "pending">, takeovers: number) {
  return outcome === "passed" && takeovers > 0 ? "partial" : outcome;
}

export async function gradeBenchmarkRun(
  db: Database,
  workspaceId: string,
  gradedBy: string,
  input: GradeBenchmarkRunInput,
): Promise<BenchmarkRunView> {
  return db.transaction(async (tx) => {
    const [row] = await selectRuns(inTx(tx))
      .where(
        and(eq(benchmarkRuns.id, input.benchmarkRunId), eq(benchmarks.workspaceId, workspaceId)),
      )
      .for("update", { of: benchmarkRuns });
    if (!row) throw new BenchmarkNotFound();
    const terminal =
      row.status !== null && (TERMINAL_RUN_STATUSES as readonly string[]).includes(row.status);
    if (row.attempt.runId !== null && !terminal) throw new BenchmarkRunNotFinished();
    const current = toRunView(row);
    const outcome = cappedOutcome(input.outcome, current.takeovers);
    const verdict = { outcome, failureNotes: input.failureNotes, gradedBy };
    if (row.attempt.outcome === "pending") {
      const finishedAt = row.runFinishedAt ?? new Date();
      await tx
        .update(benchmarkRuns)
        .set({
          ...verdict,
          steps: current.steps,
          usd: current.usd,
          inputTokens: current.inputTokens,
          outputTokens: current.outputTokens,
          takeovers: current.takeovers,
          durationMs: durationMs(row.attempt.startedAt, finishedAt),
          finishedAt,
        })
        .where(eq(benchmarkRuns.id, row.attempt.id));
    } else {
      // A re-grade changes only the verdict; the metrics stay as first snapshotted (P10a-14).
      await tx.update(benchmarkRuns).set(verdict).where(eq(benchmarkRuns.id, row.attempt.id));
    }
    const [updated] = await selectRuns(inTx(tx)).where(eq(benchmarkRuns.id, row.attempt.id));
    return toRunView(updated!);
  });
}
