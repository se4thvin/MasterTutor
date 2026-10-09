import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunTrace } from "./evidence.ts";
import { regradeRecord } from "./regrade.ts";
import { renderReport, type BenchmarkResult, type SuiteRunResult } from "./report.ts";
import { addressBar, clickOn, observe, readLinks, readPage, traceOf } from "./trace-fixtures.ts";
import type { BenchmarkSpec, Criterion, SuiteDefinition } from "./types.ts";

const SITE = "http://bench.fixtures.test:8080";
const MAIN = "11111111-1111-4111-8111-111111111111";
const GRADING = "22222222-2222-4222-8222-222222222222";
const sectionUrl = `${SITE}/library/chapter/1/section/1`;
const criterion = (readingPattern: string): Criterion => ({
  kind: "discovered_readings",
  readings: [1],
  readingPattern,
  sectionUrlPattern: `^${SITE}/library/chapter/\\d+/section/\\d+$`,
  groupPattern: "^Chapter \\d+",
  activityPattern: "PARTICIPATION ACTIVITY (\\d+(?:\\.\\d+)+)",
  otherActivityPattern: "CHALLENGE ACTIVITY",
  completedPattern: "Activity completed",
  questionPattern: "(\\d+)\\)",
  stepPattern: "\\bStep (\\d+)\\b",
  stepControlPattern: "^(?:Start|Play step)\\b",
  requireInteraction: true,
});
const spec = (readingPattern: string) =>
  ({
    key: "readings",
    toolProfile: "browser_use",
    criterion: criterion(readingPattern),
    verify: {
      task: "t",
      budget: { maxSteps: 1, maxUsd: 1, maxActiveMinutes: 1 },
      signInUrl: `${SITE}/signin`,
    },
    signInCheck: null,
  }) as unknown as BenchmarkSpec;
const suite = (readingPattern: string): SuiteDefinition => ({
  id: "fixtures",
  stack: "test",
  benchmarks: [spec(readingPattern)],
});

const traces: Record<string, RunTrace> = {
  [MAIN]: traceOf([
    observe(sectionUrl),
    clickOn("Answer 1.1.1.1", ["1) Q Answer 1.1.1.1", "PARTICIPATION ACTIVITY 1.1.1: Quiz 1) Q"]),
  ]),
  [GRADING]: traceOf([
    observe(`${SITE}/library`),
    // The live book names its readings "Assignment 1", which the first pattern did not expect.
    readLinks(`${SITE}/library`, [
      { name: "Assignment 1" },
      { name: "1.1 Variables", href: "/library/chapter/1/section/1" },
    ]),
    addressBar(sectionUrl),
    observe(sectionUrl),
    readPage(sectionUrl, "PARTICIPATION ACTIVITY 1.1.1: Quiz\n1) Q\nActivity completed"),
  ]),
};

function writeRecord(takeovers = 0): string {
  const result = {
    key: "readings",
    name: "fixtures/readings@browser_use:auto_within_allowlist#abcd1234",
    toolProfile: "browser_use",
    approvalMode: "auto_within_allowlist",
    observerMode: "shadow",
    attempt: 1,
    benchmarkRunId: null,
    runId: MAIN,
    verifyRunIds: [GRADING],
    outcome: "failed",
    verdict: {
      outcome: "failed",
      summary: "0/1 sections passed, 1 unknown",
      unmet: [],
      unvisited: [],
    },
    error: null,
    metrics: { steps: 1, usd: 0.1, durationMs: 1, takeovers },
    watch: null,
    failure: null,
    bypassNewOrigins: [],
    baselinePassed: false,
    baselineFrom: null,
    ticket: null,
  } satisfies BenchmarkResult;
  const run: SuiteRunResult = {
    suite: "fixtures",
    stack: "test",
    baseUrl: "http://localhost:18080",
    mock: true,
    mode: "continue",
    continues: null,
    command: "run",
    capUsd: 10,
    maxRunUsd: 3,
    spentBeforeUsd: 0,
    spentAfterUsd: 0.1,
    stopped: null,
    startedAt: "2026-10-08T10:00:00.000Z",
    finishedAt: "2026-10-08T10:05:00.000Z",
    results: [result],
  };
  const path = join(mkdtempSync(join(tmpdir(), "bench-regrade-")), "record.md");
  writeFileSync(path, renderReport(run, path));
  return path;
}

describe("bench regrade (I5): a finished run graded again from its stored traces, no spend", () => {
  it("records which runs to re-read: spec, main run and grading run per result", () => {
    expect(readFileSync(writeRecord(), "utf8")).toMatch(
      new RegExp(
        `specs: \\[readings@browser_use\\]\\nrun_ids: \\[${MAIN}\\]\\ngrading_run_ids: \\[${GRADING}\\]`,
      ),
    );
  });

  it("re-grades with corrected patterns, reading only the stored traces, and appends the result", async () => {
    const path = writeRecord();
    const loadTrace = vi.fn(async (_compose: readonly string[], id: string) => traces[id]!);
    const deps = { compose: ["docker", "compose"], loadTrace };
    const before = await regradeRecord(
      path,
      suite("^Reading (\\d+)$"),
      deps,
      () => "2026-10-08T12:00:00.000Z",
    );
    expect(before).toContain(
      "| 1 | Reading 1 | – | **unknown** | reading 1 was not found in any read_page result |",
    );
    const after = await regradeRecord(
      path,
      suite("^(?:Reading|Assignment) (\\d+)$"),
      deps,
      () => "2026-10-08T12:30:00.000Z",
    );
    expect(after).toContain("## Regrade (2026-10-08T12:30:00.000Z)");
    expect(after).toContain("- Outcome: **passed**");
    expect(after).toContain(
      `| 1 | 1.1 Variables | ${sectionUrl} | passed | 1/1 activities complete, every question answered and every animation step played |`,
    );
    expect(loadTrace.mock.calls.map(([, id]) => id).sort()).toEqual([MAIN, MAIN, GRADING, GRADING]);
    const text = readFileSync(path, "utf8");
    expect(text.indexOf("## Regrade (2026-10-08T12:00:00.000Z)")).toBeLessThan(
      text.indexOf("## Regrade (2026-10-08T12:30:00.000Z)"),
    );
  });

  it("refuses a record that does not list its runs", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bench-regrade-")), "record.md");
    writeFileSync(path, "---\nrecord: x\nsuite: fixtures\n---\n# old\n");
    await expect(
      regradeRecord(path, suite("x"), { compose: [], loadTrace: vi.fn() }, () => "t"),
    ).rejects.toThrow(/run_ids/);
  });
});

describe("regrade keeps the takeover rule of the original grade (re-review N2)", () => {
  it("caps a run that needed a takeover at partial, as the service does", async () => {
    const path = writeRecord(1);
    expect(readFileSync(path, "utf8")).toContain("takeovers: [1]");
    const loadTrace = vi.fn(async (_compose: readonly string[], id: string) => traces[id]!);
    const text = await regradeRecord(
      path,
      suite("^(?:Reading|Assignment) (\\d+)$"),
      { compose: [], loadTrace },
      () => "t",
    );
    expect(text).toContain(
      "- Outcome: **partial** (1 takeover: a run that needed a takeover never passes)",
    );
    expect(text).not.toContain("- Outcome: **passed**");
  });
});
