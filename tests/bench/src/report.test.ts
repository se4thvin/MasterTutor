import { describe, expect, it } from "vitest";
import {
  assertContinueAllowed,
  readFrontmatter,
  renderFailureNotes,
  renderFrontmatter,
  renderReport,
  renderTicket,
  type BenchmarkResult,
  type RecordSummary,
  type SuiteRunResult,
} from "./report.ts";

const RUN = "66666666-6666-4666-8666-666666666666";
const result: BenchmarkResult = {
  key: "reading-1",
  name: "zybooks/reading-1@computer_use:bypass#abc12345",
  toolProfile: "computer_use",
  approvalMode: "bypass",
  attempt: 1,
  benchmarkRunId: "55555555-5555-4555-8555-555555555555",
  runId: RUN,
  verifyRunIds: ["77777777-7777-4777-8777-777777777777"],
  outcome: "partial",
  verdict: {
    outcome: "partial",
    summary: "3/5 sections",
    unmet: ["1.4: 0/2 complete", "1.5: 1/2 complete"],
    unvisited: ["https://x/1.5"],
  },
  error: null,
  metrics: { steps: 212, usd: 7.31, durationMs: 3_540_000, takeovers: 0 },
  watch: {
    budgetHit: false,
    stalled: false,
    humanWait: null,
    spendCapHit: false,
    safetyChecks: [],
    autoApprovedSafetyChecks: ["irrelevant_domain"],
    takeovers: 0,
  },
  failure: {
    cls: "navigation",
    reason: "1 target page(s) never worked on",
    step: { seq: 211, url: "https://x/1.4", screenshotKey: "runs/r/steps/211-k.png" },
  },
  bypassNewOrigins: ["https://elsewhere.example"],
  baselinePassed: false,
  baselineFrom: "2026-10-06-zybooks-01",
  ticket: "BT-0003",
};
const suite: SuiteRunResult = {
  suite: "zybooks",
  stack: "local",
  baseUrl: "http://localhost:18080",
  mock: false,
  mode: "once",
  continues: null,
  command: "run --suite zybooks --only reading-1 --track computer_use --acknowledge-bypass",
  capUsd: 500,
  maxRunUsd: 50,
  spentBeforeUsd: 0,
  spentAfterUsd: 7.31,
  stopped: null,
  startedAt: "2026-10-06T10:00:00.000Z",
  finishedAt: "2026-10-06T11:00:00.000Z",
  results: [result],
};
const PATH = "orchestration/benchmarks/2026-10-06-zybooks-1/record.md";

describe("report rendering", () => {
  it("opens with frontmatter the reviewer flips, reviewed: false (D46)", () => {
    const fm = readFrontmatter(renderReport(suite, PATH));
    expect(fm).toMatchObject({
      record: "2026-10-06-zybooks-1",
      suite: "zybooks",
      stack: "local",
      mode: "once",
      reviewed: false,
      reviewed_by: null,
      authorize: 0,
      authorized_by: null,
      cap_usd: 500,
      spend_total_usd: 7.31,
      baselines_passed: [],
      baseline_from: ["2026-10-06-zybooks-01"],
      stopped: null,
      report: PATH,
    });
  });
  it("renders the summary row, the approval mode and the full failure record", () => {
    const md = renderReport(suite, PATH);
    expect(md).toContain(
      "| zybooks/reading-1@computer_use:bypass#abc12345 | computer_use | bypass | partial | 212 | $7.31 | 59m 0s | 0 | navigation (BT-0003) |",
    );
    for (const text of [
      `http://localhost:18080/runs/${RUN}`,
      `/api/runs/${RUN}/steps/211/screenshot`,
      "runs/r/steps/211-k.png",
      "1.5: 1/2 complete",
      "77777777-7777-4777-8777-777777777777",
      "BREACH: new origin approved in bypass: https://elsewhere.example",
      "Safety checks auto_approved (decided_by=bypass/policy): irrelevant_domain",
      "--continue-after-review orchestration/benchmarks/2026-10-06-zybooks-1/record.md",
    ])
      expect(md).toContain(text);
  });
  it("renders a ticket with frontmatter and the unmet list (P10b-15)", () => {
    const md = renderTicket("BT-0003", result, PATH, "2026-10-06T11:00:00.000Z");
    expect(readFrontmatter(md)).toMatchObject({
      ticket: "BT-0003",
      status: "open",
      benchmark: result.name,
      track: "computer_use",
      run_id: RUN,
      verify_run_ids: ["77777777-7777-4777-8777-777777777777"],
      report: PATH,
      created: "2026-10-06T11:00:00.000Z",
    });
    for (const text of ["navigation", "211", "1.4: 0/2 complete", "Fix acceptance"])
      expect(md).toContain(text);
  });
  it("renders failure notes stored on the benchmark run", () => {
    expect(renderFailureNotes(result.failure, result.verdict)).toMatch(
      /^class: navigation\nstep: 211/,
    );
  });
});

const rec = (id: string, fields: Record<string, unknown>): RecordSummary => ({
  id,
  path: `orchestration/benchmarks/${id}/record.md`,
  fields: {
    record: id,
    suite: "zybooks",
    spend_total_usd: 1,
    reviewed: false,
    reviewed_by: null,
    authorize: 0,
    authorized_by: null,
    ...fields,
  } as RecordSummary["fields"],
});

describe("record frontmatter (one format, shared with 07)", () => {
  it("round-trips the fields a human edits", () => {
    const text = `${renderFrontmatter({ record: "2026-10-20-zybooks-1", reviewed: false, reviewed_by: null, authorize: 0, tickets: ["BT-0001"], spend_total_usd: 0.84 })}\n# body\n`;
    expect(readFrontmatter(text)).toEqual({
      record: "2026-10-20-zybooks-1",
      reviewed: false,
      reviewed_by: null,
      authorize: 0,
      tickets: ["BT-0001"],
      spend_total_usd: 0.84,
    });
    const edited = text
      .replace("reviewed: false", "reviewed: true")
      .replace("reviewed_by: null", "reviewed_by: user")
      .replace("authorize: 0", "authorize: 3");
    expect(readFrontmatter(edited)).toMatchObject({
      reviewed: true,
      reviewed_by: "user",
      authorize: 3,
    });
  });
  it("refuses text without frontmatter", () => {
    expect(() => readFrontmatter("# no frontmatter")).toThrow(/frontmatter/);
  });
});

describe("the D46 review gate", () => {
  const first = rec("2026-10-20-zybooks-1", {});
  it("refuses an unreviewed record, or one without a reviewer", () => {
    expect(() => assertContinueAllowed(first.path, [first])).toThrow(/reviewed: true/);
    const anonymous = rec("2026-10-20-zybooks-1", { reviewed: true, authorize: 1 });
    expect(() => assertContinueAllowed(anonymous.path, [anonymous])).toThrow(/reviewed_by/);
  });
  it("refuses a reviewed record that authorizes nothing", () => {
    const none = rec("2026-10-20-zybooks-1", { reviewed: true, reviewed_by: "user", authorize: 0 });
    expect(() => assertContinueAllowed(none.path, [none])).toThrow(/authorize/);
  });
  it("allows continuing from the newest reviewed record; each continuation uses one authorization", () => {
    const ok = rec("2026-10-20-zybooks-1", { reviewed: true, reviewed_by: "user", authorize: 2 });
    expect(assertContinueAllowed(ok.path, [ok])).toBe("2026-10-20-zybooks-1");
    const next = rec("2026-10-21-zybooks-1", { authorized_by: "2026-10-20-zybooks-1" });
    expect(assertContinueAllowed(ok.path, [ok, next])).toBe("2026-10-20-zybooks-1");
    const third = rec("2026-10-21-zybooks-2", { authorized_by: "2026-10-20-zybooks-1" });
    expect(() => assertContinueAllowed(ok.path, [ok, next, third])).toThrow(/authorize/);
  });
  it("refuses a stale record when a newer one exists that it did not authorize", () => {
    const old = rec("2026-10-20-zybooks-1", { reviewed: true, reviewed_by: "user", authorize: 5 });
    const newer = rec("2026-10-22-zybooks-1", { authorized_by: "2026-10-21-zybooks-9" });
    expect(() => assertContinueAllowed(old.path, [old, newer])).toThrow(/newest/);
  });
  it("refuses a path that names no record", () => {
    expect(() => assertContinueAllowed("nope.md", [first])).toThrow(/no record/);
  });
});

describe("per-section outcomes in the record (run 1, discovered readings)", () => {
  it("lists every section with its reading, URL, outcome and reason", () => {
    const sections = [
      {
        reading: 1,
        title: "1.1 Variables",
        url: "https://x.test/c/1/s/1",
        outcome: "passed" as const,
        reason: "2/2 activities complete",
      },
      {
        reading: 3,
        title: "Reading 3",
        url: null,
        outcome: "unknown" as const,
        reason: "reading 3 was not found in any read_page result",
      },
    ];
    const md = renderReport(
      { ...suite, results: [{ ...result, verdict: { ...result.verdict!, sections } }] },
      PATH,
    );
    expect(md).toContain("| Reading | Section | URL | Outcome | Why |");
    expect(md).toContain(
      "| 1 | 1.1 Variables | https://x.test/c/1/s/1 | passed | 2/2 activities complete |",
    );
    expect(md).toContain(
      "| 3 | Reading 3 | – | **unknown** | reading 3 was not found in any read_page result |",
    );
  });
});
