import { createHash } from "node:crypto";
import type { Budget, ToolProfile } from "@mastertutor/contracts";
import { suggestFailureClass, type WatchSummary } from "./classify.ts";
import { baselineCriterion, evaluate, verifyTainted, type Verdict } from "./criteria.ts";
import { bypassNewOrigins, type RunTrace } from "./evidence.ts";
import { withScenario } from "./mock.ts";
import {
  renderFailureNotes,
  type BenchmarkResult,
  type RecordSummary,
  type SuiteRunResult,
} from "./report.ts";
import type { ApprovalMode } from "@mastertutor/contracts";
import type { BenchApprovalMode, BenchmarkSpec, SuiteDefinition, SuiteId } from "./types.ts";
import { checkVaultItem, ensureFreshLogin } from "./vault-check.ts";
import { watchRun, type WatchDeps, type WatchPolicy, type WatchState } from "./watch.ts";

/** An attempt error that already started runs keeps their ids for the record. */
class AttemptError extends Error {
  runIds: string[] = [];
}
export class BaselineIncomplete extends AttemptError {
  constructor(detail: string) {
    super(
      `Baseline is not already complete (${detail}). D32 defines this benchmark over completed work; ask the user before --allow-incomplete-baseline.`,
    );
    this.name = "BaselineIncomplete";
  }
}
export class PreconditionFailed extends AttemptError {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionFailed";
  }
}
export class TaintedVerify extends AttemptError {
  constructor() {
    super("The verify run acted on a graded page, so its evidence is not independent (P10a-24).");
    this.name = "TaintedVerify";
  }
}
export class SpendCapReached extends Error {
  constructor(spent: number, next: number, cap: number) {
    super(
      `Total spend cap reached: $${spent.toFixed(2)} spent, a $${next.toFixed(2)} run budget, cap $${cap.toFixed(2)}. Stopping (D46).`,
    );
    this.name = "SpendCapReached";
  }
}
export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

export interface SuiteRunOptions {
  /** llm-mock scenarios: harness tests on the fixtures suite only (D47). */
  mock: boolean;
  tracks: readonly ToolProfile[];
  only: readonly string[] | null;
  /** Overrides each spec's mode; null keeps the spec's. */
  approvalMode: BenchApprovalMode | null;
  bypassAcknowledged: boolean;
  maxTotalUsd: number;
  /** Per-run budget: caps Budget.maxUsd of every run the harness creates (D47). */
  maxRunUsd: number;
  /** D46: exactly one benchmark attempt, then stop for review. */
  once: boolean;
  retries: number;
  continues: string | null;
  policy: WatchPolicy;
  allowIncompleteBaseline: boolean;
  /** P10b-21: skip an attempt's own baseline when a same-day record passed it (--reuse-baseline). */
  reuseBaseline: boolean;
  command: string;
}

/** The durable ledger's view for one invocation (I2): spend never comes from the stack's database. */
export interface SpendBook {
  /** This suite's spend recorded before this invocation, crashed runs included. */
  priorUsd: number;
  /** Records this invocation's spend so far. */
  checkpoint(usd: number): void;
  /** Every agent run this invocation starts, so an interrupt can cancel it. */
  runStarted(runId: string): void;
}

export interface RunnerDeps extends WatchDeps {
  spend: SpendBook;
  compose: readonly string[];
  loadTrace(compose: readonly string[], runId: string): Promise<RunTrace>;
  reset(command: readonly string[]): Promise<void>;
  today(): string;
  /** This suite's records under orchestration/benchmarks (cli listRecords), for baseline reuse. */
  records(): RecordSummary[];
  watch?: (deps: WatchDeps, runId: string, policy: WatchPolicy) => Promise<WatchState>;
}

export const modeOf = (spec: BenchmarkSpec, options: SuiteRunOptions): ApprovalMode =>
  options.approvalMode ?? spec.approvalMode;

/** The smallest of the spec's budget, --max-run-usd (D47) and what is left of the total cap (X10). */
export function clampBudget(budget: Budget, maxRunUsd: number, remainingUsd: number): Budget {
  if (remainingUsd <= 0) throw new SpendCapReached(0, 0, 0);
  return { ...budget, maxUsd: Math.min(budget.maxUsd, maxRunUsd, remainingUsd) };
}

export function specName(
  suiteId: SuiteId,
  spec: BenchmarkSpec,
  mode: ApprovalMode,
  mock: boolean,
  budget: Budget,
): string {
  const definition = JSON.stringify({
    task: spec.task,
    origins: spec.allowedOrigins,
    budget,
    profile: spec.toolProfile,
    criterion: spec.criterion,
    signInCheck: spec.signInCheck,
    mode,
    mock,
    scenarios: mock ? spec.mockScenarios : null,
  });
  const hash = createHash("sha256").update(definition).digest("hex").slice(0, 8);
  return `${suiteId}/${spec.key}@${spec.toolProfile}:${mode}${mock ? "+mock" : ""}#${hash}`;
}

/**
 * P10b-21: the newest record from the same UTC day (by its `created` field and its id) whose own
 * baseline for exactly this spec name passed. Another day, another spec, or a failed baseline is null.
 */
export function findReusableBaseline(
  records: readonly RecordSummary[],
  specName: string,
  today: string,
): string | null {
  const reusable = records.filter((r) => {
    const created = r.fields["created"];
    const passed = r.fields["baselines_passed"];
    return (
      r.id.startsWith(`${today}-`) &&
      typeof created === "string" &&
      created.slice(0, 10) === today &&
      Array.isArray(passed) &&
      passed.includes(specName)
    );
  });
  return reusable.at(-1)?.id ?? null;
}

export function selectBenchmarks(
  suite: SuiteDefinition,
  options: SuiteRunOptions,
): BenchmarkSpec[] {
  const unknown = (options.only ?? []).filter(
    (key) => !suite.benchmarks.some((b) => b.key === key),
  );
  if (unknown.length > 0)
    throw new SelectionError(`unknown benchmark key(s) in ${suite.id}: ${unknown.join(", ")}`);
  const selected = suite.benchmarks.filter(
    (b) =>
      options.tracks.includes(b.toolProfile) &&
      (options.only === null || options.only.includes(b.key)),
  );
  if (selected.length === 0) throw new SelectionError(`nothing selected in suite ${suite.id}`);
  if (options.once && options.retries > 0)
    throw new SelectionError(
      "--once never retries (D46); --retries needs --continue-after-review <reviewed report>",
    );
  if (options.once && selected.length !== 1)
    throw new SelectionError(
      `--once runs exactly one benchmark (D46), but ${selected.length} match: narrow with --only <key> and --track <profile>`,
    );
  for (const spec of selected)
    if (modeOf(spec, options) === "bypass" && !options.bypassAcknowledged)
      throw new SelectionError(`${spec.key} runs in bypass mode: pass --acknowledge-bypass (D44)`);
  return selected;
}

function spendGuard(deps: RunnerDeps, options: SuiteRunOptions) {
  const runIds: string[] = [];
  /** The ledger total plus every run this invocation started, checkpointed each time (I2). */
  const spent = async () => {
    const usage = await Promise.all(runIds.map((runId) => deps.api.runs.get({ runId })));
    const current = usage.reduce((sum, run) => sum + run.usage.usd, 0);
    deps.spend.checkpoint(current);
    return deps.spend.priorUsd + current;
  };
  return {
    track: (runId: string) => {
      runIds.push(runId);
      deps.spend.runStarted(runId);
    },
    spent,
    remaining: async () => options.maxTotalUsd - (await spent()),
    /** Worst-case refusal for a main run, whose budget is stored on the benchmark: it must fit whole (X10). */
    async beforeRun(maxUsd: number): Promise<void> {
      const now = await spent();
      if (now + maxUsd > options.maxTotalUsd)
        throw new SpendCapReached(now, maxUsd, options.maxTotalUsd);
    },
    capReached: async () => (await spent()) >= options.maxTotalUsd,
  };
}
type SpendGuard = ReturnType<typeof spendGuard>;

async function watched(
  deps: RunnerDeps,
  guard: SpendGuard,
  runId: string,
  policy: WatchPolicy,
): Promise<WatchState> {
  return (deps.watch ?? watchRun)({ ...deps, spendCapReached: guard.capReached }, runId, policy);
}

/** A read-only evidence run (browser_use, auto mode), from a forgotten session. */
async function verifyRun(
  spec: BenchmarkSpec,
  options: SuiteRunOptions,
  deps: RunnerDeps,
  guard: SpendGuard,
) {
  const verify = spec.verify!;
  await freshLogin(spec, deps);
  // A verify run is created directly, so its budget can shrink to what is left of the cap.
  const budget = clampBudget(verify.budget, options.maxRunUsd, await guard.remaining());
  const run = await deps.api.runs.create({
    goal: withScenario(verify.task, options.mock ? (spec.mockScenarios?.verify ?? null) : null),
    allowedOrigins: [...spec.allowedOrigins],
    budget,
    targetFolderId: null,
    approvalMode: "auto_within_allowlist",
    toolProfile: "browser_use",
  });
  guard.track(run.id);
  deps.log(`verify run ${run.id} (${spec.key})`);
  const state = await watched(deps, guard, run.id, options.policy);
  return {
    runId: run.id,
    trace: await deps.loadTrace(deps.compose, run.id),
    spendCapHit: state.spendCapHit,
  };
}

async function freshLogin(spec: BenchmarkSpec, deps: RunnerDeps): Promise<void> {
  if (spec.freshLogin && spec.requiredVaultItem)
    await ensureFreshLogin(deps.api, spec.requiredVaultItem);
}

/** The benchmark's criterion, plus signInCheck on the MAIN trace (P10b-5): both must pass. */
export function gradeTraces(
  spec: BenchmarkSpec,
  main: RunTrace | null,
  verify: RunTrace | null,
): Verdict {
  const verdict = evaluate(spec.criterion, main, verify);
  if (spec.signInCheck === null || main === null) return verdict;
  const signIn = evaluate(spec.signInCheck, main, null);
  if (signIn.outcome === "passed") return verdict;
  return {
    ...verdict,
    outcome: "failed",
    unmet: [...signIn.unmet.map((u) => `signed_in: ${u}`), ...verdict.unmet],
  };
}

async function ensureBenchmark(
  deps: RunnerDeps,
  name: string,
  spec: BenchmarkSpec,
  mode: ApprovalMode,
  budget: Budget,
  task: string,
): Promise<string> {
  const existing = (await deps.api.benchmarks.list({})).items.find((b) => b.name === name);
  if (existing) return existing.id;
  const created = await deps.api.benchmarks.create({
    name,
    task,
    allowedOrigins: [...spec.allowedOrigins],
    approvalMode: mode,
    ...(mode === "bypass" ? { bypassAcknowledged: true as const } : {}),
    toolProfile: spec.toolProfile,
    budget,
    successCriteria: JSON.stringify(spec.criterion).slice(0, 4_000),
  });
  return created.id;
}

export async function runBenchmark(
  suiteId: SuiteId,
  spec: BenchmarkSpec,
  options: SuiteRunOptions,
  deps: RunnerDeps,
  guard: SpendGuard,
  attempt: number,
): Promise<BenchmarkResult> {
  const mode = modeOf(spec, options);
  const budget = clampBudget(spec.budget, options.maxRunUsd, Number.POSITIVE_INFINITY);
  const name = specName(suiteId, spec, mode, options.mock, budget);
  const verifyRunIds: string[] = [];
  try {
    if (spec.requiredVaultItem) {
      const problem = await checkVaultItem(deps.api, spec.requiredVaultItem);
      if (problem) throw new PreconditionFailed(problem);
    }
    if (spec.reset) await deps.reset(spec.reset);
    let baselinePassed = false;
    const baselineFrom =
      spec.baselineMustPass && spec.verify && options.reuseBaseline
        ? findReusableBaseline(deps.records(), name, deps.today())
        : null;
    if (baselineFrom !== null)
      deps.log(
        `${spec.key}: reusing the passing baseline of ${baselineFrom} (same UTC day, P10b-21)`,
      );
    if (spec.baselineMustPass && spec.verify && baselineFrom === null) {
      const base = await verifyRun(spec, options, deps, guard);
      verifyRunIds.push(base.runId);
      if (base.spendCapHit) throw new SpendCapReached(options.maxTotalUsd, 0, options.maxTotalUsd);
      if (verifyTainted(base.trace, spec.verify!.signInUrl, spec.criterion))
        throw new TaintedVerify();
      const verdict = evaluate(baselineCriterion(spec.criterion), null, base.trace);
      if (verdict.outcome !== "passed" && !options.allowIncompleteBaseline)
        throw new BaselineIncomplete(verdict.summary);
      baselinePassed = verdict.outcome === "passed";
    }
    await freshLogin(spec, deps);
    await guard.beforeRun(budget.maxUsd);
    const benchmarkId = await ensureBenchmark(
      deps,
      name,
      spec,
      mode,
      budget,
      withScenario(spec.task, options.mock ? (spec.mockScenarios?.main ?? null) : null),
    );
    const started = await deps.api.benchmarks.start({ benchmarkId });
    guard.track(started.runId);
    deps.log(`started ${name}: run ${started.runId}`);
    const state = await watched(deps, guard, started.runId, options.policy);
    let after: Awaited<ReturnType<typeof verifyRun>> | null = null;
    if (spec.verify && !state.spendCapHit) {
      after = await verifyRun(spec, options, deps, guard);
      verifyRunIds.push(after.runId);
    }
    const main = await deps.loadTrace(deps.compose, started.runId);
    const verdict = gradeTraces(spec, main, after?.trace ?? null);
    const tainted =
      after !== null && verifyTainted(after.trace, spec.verify!.signInUrl, spec.criterion);
    const graded = await deps.api.benchmarks.grade({
      benchmarkRunId: started.benchmarkRunId,
      outcome: tainted ? "error" : verdict.outcome,
      failureNotes: null,
    });
    const outcome = graded.outcome as BenchmarkResult["outcome"];
    const watch: WatchSummary = {
      budgetHit: state.budgetHit,
      stalled: state.stalled,
      humanWait: state.humanWait,
      spendCapHit: state.spendCapHit || (after?.spendCapHit ?? false),
      safetyChecks: state.safetyChecks,
      autoApprovedSafetyChecks: state.autoApprovedSafetyChecks,
      takeovers: graded.takeovers,
    };
    const failure =
      outcome === "passed" ? null : suggestFailureClass({ trace: main, verdict, watch });
    // The verdict is recorded once the failure class is known; the service keeps the metrics snapshot (P10a-14).
    if (failure)
      await deps.api.benchmarks.grade({
        benchmarkRunId: started.benchmarkRunId,
        outcome: graded.outcome as never,
        failureNotes: renderFailureNotes(failure, verdict),
      });
    return {
      key: spec.key,
      name,
      toolProfile: spec.toolProfile,
      approvalMode: mode,
      attempt,
      benchmarkRunId: started.benchmarkRunId,
      runId: started.runId,
      verifyRunIds,
      outcome,
      verdict,
      error: tainted ? new TaintedVerify().message : null,
      metrics: {
        steps: graded.steps,
        usd: graded.usd,
        durationMs: graded.durationMs,
        takeovers: graded.takeovers,
      },
      watch,
      failure,
      bypassNewOrigins: bypassNewOrigins(main),
      baselinePassed,
      baselineFrom,
      ticket: null,
    };
  } catch (error) {
    if (error instanceof AttemptError) error.runIds = verifyRunIds;
    throw error;
  }
}

function errorResult(
  suiteId: SuiteId,
  spec: BenchmarkSpec,
  options: SuiteRunOptions,
  attempt: number,
  error: unknown,
): BenchmarkResult {
  const mode = modeOf(spec, options);
  return {
    key: spec.key,
    name: specName(
      suiteId,
      spec,
      mode,
      options.mock,
      clampBudget(spec.budget, options.maxRunUsd, Number.POSITIVE_INFINITY),
    ),
    toolProfile: spec.toolProfile,
    approvalMode: mode,
    attempt,
    benchmarkRunId: null,
    runId: null,
    verifyRunIds: error instanceof AttemptError ? error.runIds : [],
    outcome: "error",
    verdict: null,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    metrics: { steps: 0, usd: 0, durationMs: null, takeovers: 0 },
    watch: null,
    failure: null,
    bypassNewOrigins: [],
    baselinePassed: false,
    baselineFrom: null,
    ticket: null,
  };
}

async function runEach(
  suite: SuiteDefinition,
  options: SuiteRunOptions,
  deps: RunnerDeps,
  attemptOnce: (
    spec: BenchmarkSpec,
    guard: SpendGuard,
    attempt: number,
  ) => Promise<BenchmarkResult>,
): Promise<SuiteRunResult> {
  const selected = selectBenchmarks(suite, options);
  const guard = spendGuard(deps, options);
  const startedAt = new Date().toISOString();
  const spentBeforeUsd = await guard.spent();
  const results: BenchmarkResult[] = [];
  let stopped: SuiteRunResult["stopped"] = null;
  outer: for (const spec of selected) {
    // D46: once → exactly one attempt; otherwise 1 + --retries attempts, stopping at a pass.
    for (let attempt = 1; attempt <= 1 + (options.once ? 0 : options.retries); attempt++) {
      let result: BenchmarkResult;
      try {
        result = await attemptOnce(spec, guard, attempt);
      } catch (error) {
        if (error instanceof SpendCapReached) {
          deps.log(error.message);
          stopped = "spend_cap";
          break outer;
        }
        result = errorResult(suite.id, spec, options, attempt, error);
      }
      results.push(result);
      if (result.watch?.spendCapHit) {
        stopped = "spend_cap";
        break outer;
      }
      if (result.outcome === "passed") break;
    }
  }
  return {
    suite: suite.id,
    stack: suite.stack,
    baseUrl: deps.baseUrl,
    mock: options.mock,
    mode: options.once ? "once" : "continue",
    continues: options.continues,
    command: options.command,
    capUsd: options.maxTotalUsd,
    maxRunUsd: options.maxRunUsd,
    spentBeforeUsd,
    spentAfterUsd: await guard.spent(),
    stopped,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
}

export function runSuite(
  suite: SuiteDefinition,
  options: SuiteRunOptions,
  deps: RunnerDeps,
): Promise<SuiteRunResult> {
  return runEach(suite, options, deps, (spec, guard, attempt) =>
    runBenchmark(suite.id, spec, options, deps, guard, attempt),
  );
}

/** `pnpm bench baseline`: the verify runs only (P10b-20), to prove D32 before any paid main run. */
export function runBaseline(
  suite: SuiteDefinition,
  options: SuiteRunOptions,
  deps: RunnerDeps,
): Promise<SuiteRunResult> {
  return runEach(suite, options, deps, async (spec, guard, attempt) => {
    if (!spec.verify) throw new PreconditionFailed(`${spec.key} has no verify run to baseline`);
    if (spec.requiredVaultItem) {
      const problem = await checkVaultItem(deps.api, spec.requiredVaultItem);
      if (problem) throw new PreconditionFailed(problem);
    }
    const base = await verifyRun(spec, options, deps, guard);
    const verdict = evaluate(baselineCriterion(spec.criterion), null, base.trace);
    const tainted = verifyTainted(base.trace, spec.verify!.signInUrl, spec.criterion);
    const mode = modeOf(spec, options);
    return {
      ...errorResult(suite.id, spec, options, attempt, null),
      runId: base.runId,
      verifyRunIds: [base.runId],
      outcome: tainted ? "error" : verdict.outcome === "passed" ? "passed" : "failed",
      baselinePassed: !tainted && verdict.outcome === "passed",
      verdict,
      error: tainted ? new TaintedVerify().message : null,
      approvalMode: mode,
      watch: {
        budgetHit: false,
        stalled: false,
        humanWait: null,
        spendCapHit: base.spendCapHit,
        safetyChecks: [],
        autoApprovedSafetyChecks: [],
        takeovers: 0,
      },
    };
  });
}
