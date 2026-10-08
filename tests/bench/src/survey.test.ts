import type { RunStepView } from "@mastertutor/contracts";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunTrace } from "./evidence.ts";
import type { SuiteRunResult } from "./report.ts";
import { surveyStats, writeSurveyEvidence } from "./survey.ts";

const at = (s: number) => new Date(Date.UTC(2026, 9, 20, 10, 0, s)).toISOString();
const step = (
  seq: number,
  phase: RunStepView["phase"],
  state: RunStepView["state"],
  screenshotKey: string | null,
  s: number,
): RunStepView =>
  ({
    seq,
    phase,
    state,
    caption: null,
    url: null,
    screenshotKey,
    action: null,
    createdAt: at(s),
  }) as RunStepView;
const trace: RunTrace = {
  runId: "r",
  status: "completed",
  waitReason: null,
  finalUrl: null,
  approvals: [],
  steps: [
    {
      seq: 2,
      phase: "act",
      state: "done",
      url: "https://x.test/a",
      screenshotKey: "k1",
      caption: null,
      tool: "read_page",
      interaction: false,
      credentialError: null,
      readPage: {
        hash: "a".repeat(64),
        url: "https://x.test/a",
        title: "t",
        text: "Jane Student PARTICIPATION ACTIVITY",
      } as never,
    },
  ],
};

describe("surveyStats (P10b-17)", () => {
  it("reports step timing, dropped screenshots and refused acts", () => {
    const steps = [
      step(1, "observe", "done", "k1", 0),
      step(2, "act", "done", null, 2),
      step(3, "observe", "done", null, 10),
      step(4, "act", "skipped", null, 11),
    ];
    expect(surveyStats(steps, trace)).toEqual({
      steps: 4,
      medianStepMs: 2000,
      maxStepMs: 8000,
      droppedScreenshots: [3],
      refusedActs: [4],
      credentialErrors: [],
    });
  });
});

describe("writeSurveyEvidence", () => {
  it("writes raw page text only to the raw folder, and appends stats (no page text) to the record", async () => {
    const root = mkdtempSync(join(tmpdir(), "mt-survey-"));
    const recordPath = join(root, "record.md");
    writeFileSync(recordPath, "---\nrecord: x\n---\n# record\n");
    const result = {
      results: [{ runId: "11111111-1111-4111-8111-111111111111" }],
    } as unknown as SuiteRunResult;
    const api = {
      runs: {
        steps: vi.fn(async () => ({
          items: [step(1, "observe", "done", "k1", 0), step(2, "act", "done", null, 1)],
        })),
      },
    };
    const raw = await writeSurveyEvidence(
      result,
      recordPath,
      { api: api as never, compose: ["docker", "compose"], loadTrace: vi.fn(async () => trace) },
      join(root, ".raw"),
    );
    expect(raw).not.toBeNull();
    expect(readFileSync(raw!, "utf8")).toContain("Jane Student");
    const record = readFileSync(recordPath, "utf8");
    expect(record).toContain("## Survey");
    expect(record).not.toContain("Jane Student");
    expect(readdirSync(join(root, ".raw"))).toHaveLength(1);
  });
  it("does nothing when the survey run never started", async () => {
    const result = { results: [{ runId: null }] } as unknown as SuiteRunResult;
    await expect(
      writeSurveyEvidence(result, "unused", { api: {} as never, compose: [], loadTrace: vi.fn() }),
    ).resolves.toBeNull();
  });
});
