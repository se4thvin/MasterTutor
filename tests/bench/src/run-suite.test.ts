import { describe, expect, it, vi } from "vitest";
import { observe, computer, readPage, traceOf } from "./trace-fixtures.ts";
import type { RecordSummary } from "./report.ts";
import {
  SelectionError,
  clampBudget,
  findReusableBaseline,
  runSuite,
  specName,
  type RunnerDeps,
  type SuiteRunOptions,
} from "./run-suite.ts";
import type { BenchmarkSpec, SuiteDefinition } from "./types.ts";
import { initialWatchState } from "./watch.ts";

const BOOK = "http://bench.fixtures.test/book";
const click = computer({ type: "click", x: 5, y: 5, button: "left" });
const spec = (over: Partial<BenchmarkSpec> = {}): BenchmarkSpec => ({
  key: "activities",
  task: "Do the activities",
  allowedOrigins: ["http://bench.fixtures.test"],
  budget: { maxSteps: 60, maxUsd: 5, maxActiveMinutes: 10 },
  toolProfile: "computer_use",
  approvalMode: "auto_within_allowlist",
  criterion: { kind: "page_text", url: BOOK, mustMatch: ["3 of 3"] },
  verify: {
    task: "Read the book page",
    budget: { maxSteps: 20, maxUsd: 1, maxActiveMinutes: 5 },
    signInUrl: "http://bench.fixtures.test/signin",
  },
  baselineMustPass: true,
  freshLogin: true,
  signInCheck: null,
  requiredVaultItem: {
    alias: "site",
    origin: "http://login.fixtures.test",
    fields: ["username", "password"],
  },
  reset: null,
  mockScenarios: null,
  ...over,
});
const suite = (...benchmarks: BenchmarkSpec[]): SuiteDefinition => ({
  id: "fixtures",
  stack: "test",
  benchmarks,
});
const options = (over: Partial<SuiteRunOptions> = {}): SuiteRunOptions => ({
  mock: false,
  tracks: ["computer_use", "browser_use"],
  only: null,
  approvalMode: null,
  bypassAcknowledged: false,
  maxTotalUsd: 10,
  maxRunUsd: 1,
  once: false,
  retries: 0,
  continues: null,
  policy: {
    onBudget: "finish_now",
    onSafetyCheck: "deny",
    humanTimeoutMs: 1_200_000,
    stallMs: 600_000,
  },
  allowIncompleteBaseline: false,
  reuseBaseline: false,
  command: "run --suite fixtures",
  ...over,
});

function fake(
  over: {
    spent?: number;
    runUsd?: number;
    sessionSaved?: boolean;
    verifyText?: string;
    verifyActs?: boolean;
    verifyWorksElsewhere?: boolean;
    records?: RecordSummary[];
  } = {},
) {
  let n = 0;
  const calls: string[] = [];
  const api = {
    benchmarks: {
      list: vi.fn(async () => ({ items: [] })),
      create: vi.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333" })),
      start: vi.fn(async () => {
        calls.push("main");
        n++;
        return { benchmarkRunId: `br-${n}`, runId: `main-${n}` };
      }),
      grade: vi.fn(async (input: { outcome: string }) => ({
        outcome: input.outcome,
        steps: 5,
        usd: 0.1,
        durationMs: 1000,
        takeovers: 0,
      })),
    },
    runs: {
      create: vi.fn(async () => {
        calls.push("verify");
        n++;
        return { id: `verify-${n}` };
      }),
      cancel: vi.fn(),
      decideApproval: vi.fn(),
      get: vi.fn(async () => ({ usage: { usd: over.runUsd ?? 0 } })),
    },
    vault: {
      list: vi.fn(async () => ({
        items: [
          {
            alias: "site",
            origin: "http://login.fixtures.test",
            fields: ["username", "password"],
            sessionSaved: over.sessionSaved ?? false,
          },
        ],
      })),
      forgetSession: vi.fn(async () => {
        calls.push("forget");
        return { ok: true };
      }),
    },
  };
  const verify = traceOf([
    ...(over.verifyWorksElsewhere ? [observe(`${BOOK}/activities`), click] : []),
    observe(BOOK),
    ...(over.verifyActs ? [click] : []),
    readPage(BOOK, over.verifyText ?? "3 of 3"),
  ]);
  const main = traceOf([observe(BOOK), click]);
  const deps = {
    api,
    baseUrl: "http://localhost:18080",
    cookie: "c",
    log: () => undefined,
    now: () => 0,
    today: () => "2026-10-06",
    records: () => over.records ?? [],
    compose: ["docker", "compose"],
    loadTrace: vi.fn(async (_compose: readonly string[], id: string) =>
      id.startsWith("verify") ? verify : main,
    ),
    reset: vi.fn(async () => undefined),
    // The durable ledger's total before this invocation (I2); the stack's usage API is never read.
    spend: { priorUsd: over.spent ?? 0, checkpoint: vi.fn() },
    watch: vi.fn(async () => ({
      ...initialWatchState(0),
      status: "completed" as const,
      done: true,
    })),
  } as unknown as RunnerDeps;
  return { deps, api, calls };
}

describe("D46: one zyBooks-style run, then stop", () => {
  it("--once with more than one selected benchmark starts nothing", async () => {
    const { deps, api } = fake();
    const two = suite(spec(), spec({ key: "second" }));
    await expect(runSuite(two, options({ once: true }), deps)).rejects.toBeInstanceOf(
      SelectionError,
    );
    expect(api.benchmarks.start).not.toHaveBeenCalled();
    expect(api.runs.create).not.toHaveBeenCalled();
  });

  it("--once runs exactly one attempt, even when it fails, and never retries", async () => {
    const { deps, api } = fake({ verifyText: "1 of 3" });
    const result = await runSuite(
      suite(spec({ baselineMustPass: false })),
      options({ once: true }),
      deps,
    );
    expect(result.mode).toBe("once");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.outcome).toBe("failed");
    expect(api.benchmarks.start).toHaveBeenCalledTimes(1);
  });

  it("--once refuses --retries (only a reviewed continuation may retry)", async () => {
    const { deps, api } = fake();
    await expect(
      runSuite(suite(spec()), options({ once: true, retries: 1 }), deps),
    ).rejects.toThrow(/continue-after-review/);
    expect(api.benchmarks.start).not.toHaveBeenCalled();
  });

  it("after review, --retries N retries a failing attempt N times and stops at a pass", async () => {
    const failing = fake({ verifyText: "1 of 3" });
    await runSuite(
      suite(spec({ baselineMustPass: false })),
      options({ retries: 2, continues: "r.md" }),
      failing.deps,
    );
    expect(failing.api.benchmarks.start).toHaveBeenCalledTimes(3);
    const passing = fake();
    await runSuite(
      suite(spec({ baselineMustPass: false })),
      options({ retries: 2, continues: "r.md" }),
      passing.deps,
    );
    expect(passing.api.benchmarks.start).toHaveBeenCalledTimes(1);
  });
});

describe("fresh login and spend (P10b-4, X10)", () => {
  it("forgets the saved session before every agent run: baseline, main and verify", async () => {
    const { deps, calls } = fake();
    await runSuite(suite(spec()), options(), deps);
    expect(calls).toEqual(["forget", "verify", "forget", "main", "forget", "verify"]);
  });

  it("refuses to run while a saved session survives forgetSession", async () => {
    const { deps, api } = fake({ sessionSaved: true });
    const result = await runSuite(suite(spec()), options(), deps);
    expect(result.results[0]).toMatchObject({ outcome: "error" });
    expect(result.results[0]!.error).toMatch(/saved session/);
    expect(api.runs.create).not.toHaveBeenCalled();
    expect(api.benchmarks.start).not.toHaveBeenCalled();
  });

  it("starts nothing once the cap is spent, and records the stop", async () => {
    const { deps, api } = fake({ spent: 10 });
    const result = await runSuite(suite(spec()), options({ maxTotalUsd: 10, maxRunUsd: 1 }), deps);
    expect(result.stopped).toBe("spend_cap");
    expect(result.spentBeforeUsd).toBe(10);
    expect(api.runs.create).not.toHaveBeenCalled();
  });

  it("clamps a verify run to what is left, and refuses a main run whose stored budget does not fit (X10)", async () => {
    const { deps, api } = fake({ spent: 9.5 });
    const result = await runSuite(suite(spec()), options({ maxTotalUsd: 10, maxRunUsd: 1 }), deps);
    expect(api.runs.create).toHaveBeenCalledTimes(1);
    expect(api.runs.create).toHaveBeenCalledWith(
      expect.objectContaining({ budget: { maxSteps: 20, maxUsd: 0.5, maxActiveMinutes: 5 } }),
    );
    expect(api.benchmarks.start).not.toHaveBeenCalled();
    expect(result.stopped).toBe("spend_cap");
  });

  it("checkpoints this invocation's spend into the ledger from its own runs (I2)", async () => {
    const { deps } = fake({ spent: 1, runUsd: 0.2 });
    const result = await runSuite(suite(spec()), options(), deps);
    expect(result.spentBeforeUsd).toBe(1);
    expect(result.spentAfterUsd).toBeCloseTo(1.6);
    expect(deps.spend.checkpoint).toHaveBeenLastCalledWith(expect.closeTo(0.6));
  });

  it("the watcher's cap check counts the ledger plus this invocation's runs (I2)", async () => {
    const { deps } = fake({ spent: 9.9, runUsd: 0.2 });
    const seen: boolean[] = [];
    deps.watch = vi.fn(async (watchDeps) => {
      seen.push(await watchDeps.spendCapReached!());
      return {
        ...initialWatchState(0),
        status: "completed" as const,
        done: true,
        spendCapHit: true,
      };
    });
    const result = await runSuite(suite(spec()), options({ maxTotalUsd: 10, maxRunUsd: 1 }), deps);
    expect(seen).toEqual([true]);
    expect(result.stopped).toBe("spend_cap");
  });

  it("clampBudget takes the smallest of the spec, --max-run-usd and what is left", () => {
    const budget = { maxSteps: 900, maxUsd: 50, maxActiveMinutes: 180 };
    expect(clampBudget(budget, 50, 500).maxUsd).toBe(50);
    expect(clampBudget(budget, 20, 500).maxUsd).toBe(20);
    expect(clampBudget(budget, 50, 7.5)).toEqual({ ...budget, maxUsd: 7.5 });
    expect(() => clampBudget(budget, 50, 0)).toThrow(/spend cap/);
  });

  it("skips the forget step for a spec without freshLogin", async () => {
    const { deps, calls } = fake();
    await runSuite(suite(spec({ freshLogin: false })), options(), deps);
    expect(calls).toEqual(["verify", "main", "verify"]);
  });

  it("evaluates signInCheck on the MAIN trace and fails the attempt when it fails (P10b-5)", async () => {
    const { deps } = fake();
    const check = {
      kind: "signed_in" as const,
      origin: "https://learn.example",
      signInPath: "/signin",
    };
    const result = await runSuite(suite(spec({ signInCheck: check })), options(), deps);
    expect(result.results[0]!.outcome).toBe("failed");
    expect(result.results[0]!.verdict!.unmet.join("\n")).toMatch(/signed_in: .*credential fill/);
  });

  it("caps each run's budget at --max-run-usd through the existing budget field (D47)", async () => {
    const { deps, api } = fake();
    await runSuite(suite(spec()), options({ maxRunUsd: 0.5 }), deps);
    expect(api.benchmarks.create).toHaveBeenCalledWith(
      expect.objectContaining({ budget: { maxSteps: 60, maxUsd: 0.5, maxActiveMinutes: 10 } }),
    );
    expect(api.runs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: { maxSteps: 20, maxUsd: 0.5, maxActiveMinutes: 5 },
        approvalMode: "auto_within_allowlist",
        toolProfile: "browser_use",
      }),
    );
  });
});

describe("grading, modes and selection", () => {
  it("stops before acting when the baseline is not already complete (D32)", async () => {
    const { deps, api } = fake({ verifyText: "1 of 3" });
    const result = await runSuite(suite(spec()), options(), deps);
    expect(result.results[0]).toMatchObject({ outcome: "error" });
    expect(result.results[0]!.error).toMatch(/Baseline/);
    expect(api.benchmarks.start).not.toHaveBeenCalled();
  });

  it("grades a passing run passed and records the graded metrics", async () => {
    const { deps, api } = fake();
    const result = await runSuite(suite(spec()), options(), deps);
    expect(result.results[0]).toMatchObject({
      outcome: "passed",
      metrics: { steps: 5, usd: 0.1, takeovers: 0 },
    });
    expect(api.benchmarks.grade).toHaveBeenCalledWith(
      expect.objectContaining({ benchmarkRunId: "br-2", outcome: "passed" }),
    );
  });

  it("grades error when the verify run acted on a graded page (P10a-24)", async () => {
    const { deps } = fake({ verifyActs: true });
    const result = await runSuite(suite(spec({ baselineMustPass: false })), options(), deps);
    expect(result.results[0]).toMatchObject({ outcome: "error" });
  });

  it("grades error when the verify run did the work on a page that is not graded (I3)", async () => {
    const { deps } = fake({ verifyWorksElsewhere: true });
    const result = await runSuite(suite(spec({ baselineMustPass: false })), options(), deps);
    expect(result.results[0]).toMatchObject({ outcome: "error" });
  });

  describe("same-day baseline reuse (P10b-21)", () => {
    // The name hashes the capped per-run budget (P10a-27): options() caps it at maxRunUsd 1.
    const name = specName(
      "fixtures",
      spec(),
      "auto_within_allowlist",
      false,
      clampBudget(spec().budget, 1, Number.POSITIVE_INFINITY),
    );
    const record = (id: string, created: string, passed: string[]): RecordSummary => ({
      id,
      path: `orchestration/benchmarks/${id}/record.md`,
      fields: { record: id, suite: "fixtures", created, baselines_passed: passed },
    });
    const today = record("2026-10-06-fixtures-01", "2026-10-06T09:00:00.000Z", [name]);

    it("reuses a same-day passing baseline: no baseline run, cited in baseline_from", async () => {
      const { deps, calls } = fake({ records: [today] });
      const result = await runSuite(suite(spec()), options({ reuseBaseline: true }), deps);
      expect(calls).toEqual(["forget", "main", "forget", "verify"]);
      expect(result.results[0]).toMatchObject({
        outcome: "passed",
        baselineFrom: "2026-10-06-fixtures-01",
        baselinePassed: false,
      });
    });
    it("refuses yesterday's record and runs its own baseline", async () => {
      const yesterday = record("2026-10-05-fixtures-01", "2026-10-05T23:59:00.000Z", [name]);
      const { deps, calls } = fake({ records: [yesterday] });
      const result = await runSuite(suite(spec()), options({ reuseBaseline: true }), deps);
      expect(calls).toEqual(["forget", "verify", "forget", "main", "forget", "verify"]);
      expect(result.results[0]).toMatchObject({ baselineFrom: null, baselinePassed: true });
    });
    it("refuses a record whose baseline failed, or one for another spec", () => {
      expect(
        findReusableBaseline(
          [record("2026-10-06-fixtures-01", "2026-10-06T09:00:00.000Z", [])],
          name,
          "2026-10-06",
        ),
      ).toBeNull();
      expect(
        findReusableBaseline(
          [record("2026-10-06-fixtures-01", "2026-10-06T09:00:00.000Z", ["fixtures/other@x#1"])],
          name,
          "2026-10-06",
        ),
      ).toBeNull();
      expect(findReusableBaseline([today], name, "2026-10-06")).toBe("2026-10-06-fixtures-01");
    });
    it("with the option off, always runs its own baseline", async () => {
      const { deps, calls } = fake({ records: [today] });
      await runSuite(suite(spec()), options(), deps);
      expect(calls).toEqual(["forget", "verify", "forget", "main", "forget", "verify"]);
    });
    it("never lifts --once: two selected benchmarks still start nothing", async () => {
      const { deps, api } = fake({ records: [today] });
      await expect(
        runSuite(
          suite(spec(), spec({ key: "second" })),
          options({ once: true, reuseBaseline: true }),
          deps,
        ),
      ).rejects.toBeInstanceOf(SelectionError);
      expect(api.benchmarks.start).not.toHaveBeenCalled();
    });
  });

  it("bypass needs the acknowledgement and sends it (D44, X3)", async () => {
    const bypass = suite(spec({ approvalMode: "bypass", baselineMustPass: false }));
    await expect(runSuite(bypass, options(), fake().deps)).rejects.toThrow(/acknowledge-bypass/);
    const { deps, api } = fake();
    await runSuite(bypass, options({ bypassAcknowledged: true }), deps);
    expect(api.benchmarks.create).toHaveBeenCalledWith(
      expect.objectContaining({ approvalMode: "bypass", bypassAcknowledged: true }),
    );
  });

  it("refuses unknown keys and an empty selection (P10a-29)", async () => {
    await expect(runSuite(suite(spec()), options({ only: ["nope"] }), fake().deps)).rejects.toThrow(
      /unknown benchmark/,
    );
    await expect(
      runSuite(suite(spec()), options({ tracks: ["browser_use"] }), fake().deps),
    ).rejects.toThrow(/nothing selected/);
    await expect(runSuite(suite(), options(), fake().deps)).rejects.toThrow(/nothing selected/);
  });

  it("names benchmarks by suite, key, track, mode, mock and definition hash (P10a-27)", () => {
    const budget = spec().budget;
    expect(specName("fixtures", spec(), "auto_within_allowlist", false, budget)).toMatch(
      /^fixtures\/activities@computer_use:auto_within_allowlist#[0-9a-f]{8}$/,
    );
    expect(specName("fixtures", spec(), "auto_within_allowlist", true, budget)).not.toBe(
      specName("fixtures", spec(), "auto_within_allowlist", false, budget),
    );
    expect(specName("fixtures", spec(), "bypass", false, budget)).not.toBe(
      specName("fixtures", spec(), "auto_within_allowlist", false, budget),
    );
  });
});
