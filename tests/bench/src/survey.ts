// The zyBooks calibration survey's extra evidence (P10b-17, P10b-20). Raw page text contains the user's
// name, so it goes only to the git-ignored orchestration/benchmarks/.raw/ (T19's .gitignore). The record
// gets numbers, never page text.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunStepView } from "@mastertutor/contracts";
import type { RunTrace } from "./evidence.ts";
import type { SuiteRunResult } from "./report.ts";
import type { RunnerDeps } from "./run-suite.ts";

export interface SurveyStats {
  steps: number;
  medianStepMs: number;
  maxStepMs: number;
  droppedScreenshots: number[];
  refusedActs: number[];
  credentialErrors: number[];
}

/** Per-step latency, observe steps whose screenshot was dropped, and acts that were skipped or aborted. */
export function surveyStats(steps: readonly RunStepView[], trace: RunTrace): SurveyStats {
  const gaps = steps
    .slice(1)
    .map((s, i) => Date.parse(s.createdAt) - Date.parse(steps[i]!.createdAt))
    .sort((a, b) => a - b);
  return {
    steps: steps.length,
    medianStepMs: gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)]! : 0,
    maxStepMs: gaps.at(-1) ?? 0,
    droppedScreenshots: steps
      .filter((s) => s.phase === "observe" && s.screenshotKey === null)
      .map((s) => s.seq),
    refusedActs: steps
      .filter((s) => s.phase === "act" && (s.state === "skipped" || s.state === "aborted"))
      .map((s) => s.seq),
    credentialErrors: trace.steps.filter((s) => s.credentialError !== null).map((s) => s.seq),
  };
}

export async function writeSurveyEvidence(
  result: SuiteRunResult,
  recordPath: string,
  deps: Pick<RunnerDeps, "api" | "compose" | "loadTrace">,
  rawRoot = "orchestration/benchmarks/.raw",
): Promise<string | null> {
  const runId = result.results[0]?.runId ?? null;
  if (runId === null) return null;
  const trace = await deps.loadTrace(deps.compose, runId);
  // runs.steps pages at 500 rows; a 120-step survey writes several rows per step.
  const steps: RunStepView[] = [];
  for (let afterSeq: number | null = null; ;) {
    const page: RunStepView[] = (await deps.api.runs.steps({ runId, afterSeq, limit: 500 })).items;
    steps.push(...page);
    if (page.length < 500) break;
    afterSeq = page.at(-1)!.seq;
  }
  const stats = surveyStats(steps, trace);
  mkdirSync(rawRoot, { recursive: true });
  const raw = join(rawRoot, `zybooks-survey-${runId}.json`);
  const pages = trace.steps
    .filter((s) => s.readPage !== null)
    .map((s) => ({ seq: s.seq, url: s.url, readPage: s.readPage }));
  writeFileSync(raw, JSON.stringify({ runId, stats, pages }, null, 2), { mode: 0o600 });
  appendFileSync(
    recordPath,
    [
      "",
      "## Survey",
      "",
      `- Raw evidence (git-ignored, contains personal page text; never paste it): \`${raw}\``,
      `- read_page results: ${pages.length}`,
      `- Steps ${stats.steps}; median step ${stats.medianStepMs} ms; max step ${stats.maxStepMs} ms`,
      `- Dropped screenshots at seq: ${stats.droppedScreenshots.join(", ") || "none"}`,
      `- Refused or aborted acts at seq: ${stats.refusedActs.join(", ") || "none"}`,
      `- Credential errors at seq: ${stats.credentialErrors.join(", ") || "none"}`,
      "",
      "Next: the orchestrator authors orchestration/benchmarks/zybooks/sections.json from the raw file (schema: ZybooksCalibration).",
      "",
    ].join("\n"),
  );
  return raw;
}
