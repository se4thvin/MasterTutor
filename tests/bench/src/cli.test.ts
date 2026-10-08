import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BenchApi } from "./app-client.ts";
import {
  BENCH_EXIT,
  UsageError,
  exitCodeOf,
  listRecords,
  parseCli,
  vaultCheck,
  writeRecord,
} from "./cli.ts";
import type { SuiteDefinition } from "./types.ts";
import type { BenchmarkResult, RecordSummary, SuiteRunResult } from "./report.ts";

const ID = "2026-10-06-zybooks-01";
const PATH = `orchestration/benchmarks/${ID}/record.md`;
const rec = (fields: Record<string, unknown>, id = ID): RecordSummary => ({
  id,
  path: `orchestration/benchmarks/${id}/record.md`,
  fields: {
    record: id,
    suite: "zybooks",
    reviewed: false,
    reviewed_by: null,
    authorize: 0,
    authorized_by: null,
    ...fields,
  } as RecordSummary["fields"],
});
const approved = rec({ reviewed: true, reviewed_by: "user", authorize: 1 });
const run = (argv: string[], records: RecordSummary[] = []) => {
  const cmd = parseCli(argv, () => records);
  if (cmd.kind !== "run" && cmd.kind !== "baseline") throw new Error("not a run");
  return cmd;
};

describe("CLI defaults (D46, D47)", () => {
  it("zyBooks: exactly one run, no retries, $500 cap, $50 per run, a person decides budgets and safety checks", () => {
    const cmd = run([
      "run",
      "--suite",
      "zybooks",
      "--only",
      "login",
      "--track",
      "computer_use",
      "--acknowledge-bypass",
    ]);
    expect(cmd.options).toMatchObject({
      once: true,
      retries: 0,
      continues: null,
      maxTotalUsd: 500,
      maxRunUsd: 50,
      tracks: ["computer_use"],
      only: ["login"],
      bypassAcknowledged: true,
      policy: { onBudget: "ask_human", onSafetyCheck: "ask_human", humanTimeoutMs: 20 * 60_000 },
    });
  });
  it("fixtures: $10 cap, $3 per run, not once, the harness decides budgets and denies safety checks", () => {
    expect(run(["run", "--suite", "fixtures"]).options).toMatchObject({
      once: false,
      maxTotalUsd: 10,
      maxRunUsd: 3,
      tracks: ["browser_use", "computer_use"],
      policy: { onBudget: "finish_now", onSafetyCheck: "deny" },
    });
  });
});

describe("no second zyBooks run without a reviewed record (D46)", () => {
  it("refuses --retries without --continue-after-review", () => {
    expect(() => run(["run", "--suite", "zybooks", "--retries", "1"])).toThrow(
      /continue-after-review/,
    );
  });
  it("refuses a missing record, an unreviewed one, one with no reviewer and one that authorizes nothing", () => {
    const cont = ["run", "--suite", "zybooks", "--continue-after-review", PATH];
    expect(() => run(cont)).toThrow(/no record/);
    expect(() => run(cont, [rec({})])).toThrow(/reviewed: true/);
    expect(() => run(cont, [rec({ reviewed: true, authorize: 1 })])).toThrow(/reviewed_by/);
    expect(() => run(cont, [rec({ reviewed: true, reviewed_by: "user", authorize: 0 })])).toThrow(
      /authorize/,
    );
  });
  it("a reviewed record lifts --once and allows retries; continues is the authorizing record id", () => {
    const cmd = run(
      ["run", "--suite", "zybooks", "--continue-after-review", PATH, "--retries", "1"],
      [approved],
    );
    expect(cmd.options).toMatchObject({ once: false, retries: 1, continues: ID });
  });
  it("authorize: 1 allows exactly one continued invocation (D46)", () => {
    const used = rec({ authorized_by: ID }, "2026-10-07-zybooks-01");
    expect(() =>
      run(["run", "--suite", "zybooks", "--continue-after-review", PATH], [approved, used]),
    ).toThrow(/used up/);
  });
  it("--once and --continue-after-review conflict; baseline obeys the same gate", () => {
    expect(() =>
      run(["run", "--suite", "zybooks", "--once", "--continue-after-review", PATH], [approved]),
    ).toThrow(UsageError);
    expect(run(["baseline", "--suite", "zybooks"]).options.once).toBe(true);
  });
});

describe("refusals", () => {
  it("bypass needs --acknowledge-bypass (D44)", () => {
    expect(() => run(["run", "--suite", "fixtures", "--approval-mode", "bypass"])).toThrow(
      /acknowledge-bypass/,
    );
    expect(
      run(["run", "--suite", "fixtures", "--approval-mode", "bypass", "--acknowledge-bypass"])
        .options,
    ).toMatchObject({ approvalMode: "bypass", bypassAcknowledged: true });
  });
  it("--mock is for harness tests on the fixtures suite only (D47)", () => {
    expect(() => run(["run", "--suite", "zybooks", "--mock"])).toThrow(/mock/);
    expect(run(["run", "--suite", "fixtures", "--mock"]).options.mock).toBe(true);
  });
  it("validates tracks, money, timeouts and unknown flags (no credential flag exists, D34)", () => {
    expect(() => run(["run", "--suite", "fixtures", "--track", "pixels"])).toThrow(UsageError);
    expect(() => run(["run", "--suite", "zybooks", "--max-total-usd", "600"])).toThrow(/500/);
    expect(() => run(["run", "--suite", "fixtures", "--max-total-usd", "NaN"])).toThrow(UsageError);
    expect(() => run(["run", "--suite", "fixtures", "--max-run-usd", "20"])).toThrow(/max-run-usd/);
    expect(() => run(["run", "--suite", "zybooks", "--human-timeout-min", "5"])).toThrow(/15/);
    expect(() => parseCli(["run", "--suite", "zybooks", "--password", "x"], () => [])).toThrow();
    expect(() => parseCli(["run", "--suite", "other"], () => [])).toThrow(UsageError);
  });
});

describe("--reuse-baseline (P10b-21)", () => {
  it("is off by default and set by the flag, and never lifts the D46 gate", () => {
    expect(run(["run", "--suite", "fixtures"]).options.reuseBaseline).toBe(false);
    expect(run(["run", "--suite", "fixtures", "--reuse-baseline"]).options.reuseBaseline).toBe(
      true,
    );
    expect(run(["run", "--suite", "zybooks", "--reuse-baseline"]).options).toMatchObject({
      once: true,
      retries: 0,
    });
    expect(() => run(["run", "--suite", "zybooks", "--reuse-baseline", "--retries", "1"])).toThrow(
      /continue-after-review/,
    );
  });
});

describe("exit codes", () => {
  const requirement = {
    alias: "site",
    origin: "https://learn.example",
    fields: ["username", "password"] as const,
  };
  const suiteWith = (): SuiteDefinition => ({
    id: "zybooks",
    stack: "local",
    benchmarks: [
      { requiredVaultItem: requirement } as unknown as SuiteDefinition["benchmarks"][number],
    ],
  });
  const api = (items: unknown[]) =>
    ({ vault: { list: vi.fn(async () => ({ items })) } }) as unknown as BenchApi;
  const item = (over: Record<string, unknown> = {}) => ({
    alias: "site",
    origin: "https://learn.example",
    fields: ["username", "password"],
    sessionSaved: false,
    ...over,
  });

  it("vault-check exits 0 only when the item is ready and complete", async () => {
    const ready = await vaultCheck(api([item()]), suiteWith());
    expect(ready.code).toBe(BENCH_EXIT.ok);
    expect(ready.lines.join("\n")).toMatch(/is ready/);
  });
  it("vault-check exits 3, still printing the status, when the item is missing, incomplete or on another origin", async () => {
    for (const items of [
      [],
      [item({ fields: ["username"] })],
      [item({ origin: "https://other.example" })],
    ]) {
      const result = await vaultCheck(api(items), suiteWith());
      expect(result.code).toBe(BENCH_EXIT.vaultNotReady);
      expect(result.code).toBe(3);
      expect(result.lines.join("\n")).toMatch(/not ready/);
    }
  });
  it("a usage error exits 2; any other failure exits 1", () => {
    let caught: unknown;
    try {
      parseCli(["vault-check", "--suite", "other"], () => []);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UsageError);
    expect(exitCodeOf(caught)).toBe(2);
    expect(exitCodeOf(new Error("boom"))).toBe(1);
  });
});

describe("records", () => {
  const result = (mock: boolean): SuiteRunResult => ({
    suite: "fixtures",
    stack: "test",
    baseUrl: "http://localhost:18080",
    mock,
    mode: "continue",
    continues: null,
    command: "run --suite fixtures",
    capUsd: 10,
    maxRunUsd: 1,
    spentBeforeUsd: 0,
    spentAfterUsd: 0.1,
    stopped: null,
    startedAt: "2026-10-06T10:00:00.000Z",
    finishedAt: "2026-10-06T10:05:00.000Z",
    results: [
      {
        key: "activities",
        name: "fixtures/activities@computer_use:auto_within_allowlist#abcd1234",
        toolProfile: "computer_use",
        approvalMode: "auto_within_allowlist",
        attempt: 1,
        benchmarkRunId: null,
        runId: null,
        verifyRunIds: [],
        outcome: "failed",
        verdict: { outcome: "failed", summary: "0/1", unmet: ["x"], unvisited: [] },
        error: null,
        metrics: { steps: 1, usd: 0.1, durationMs: 1, takeovers: 0 },
        watch: null,
        failure: null,
        bypassNewOrigins: [],
        baselinePassed: false,
        baselineFrom: null,
        ticket: null,
      } satisfies BenchmarkResult,
    ],
  });
  it("a --mock record writes no tickets (P10b-15)", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-rec-"));
    const path = writeRecord(result(true), root);
    expect(path).toBe(join(root, "2026-10-06-fixtures-01", "record.md"));
    expect(readFileSync(path, "utf8")).toContain("reviewed: false");
    expect(readdirSync(root)).toEqual(["2026-10-06-fixtures-01"]);
  });
  it("a real record writes one ticket per non-passing result, numbered on", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-rec-"));
    writeRecord(result(false), root);
    writeRecord(result(false), root);
    expect(readdirSync(join(root, "tickets")).sort()).toEqual(["BT-0001.md", "BT-0002.md"]);
    expect(
      readdirSync(root)
        .filter((d) => d.startsWith("2026"))
        .sort(),
    ).toEqual(["2026-10-06-fixtures-01", "2026-10-06-fixtures-02"]);
  });
  it("lists a suite's records for the review gate, a continuation carrying authorized_by and authorize: 0", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-rec-"));
    writeRecord(result(false), root);
    writeRecord({ ...result(false), continues: "2026-10-06-fixtures-01" }, root);
    const records = listRecords("fixtures", root);
    expect(records.map((r) => [r.id, r.fields["authorize"], r.fields["authorized_by"]])).toEqual([
      ["2026-10-06-fixtures-01", 0, null],
      ["2026-10-06-fixtures-02", 0, "2026-10-06-fixtures-01"],
    ]);
    expect(listRecords("zybooks", root)).toEqual([]);
  });
});
