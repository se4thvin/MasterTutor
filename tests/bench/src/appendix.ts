// D46: the outcome record must carry per-step evidence, the approvals encountered and the fresh-login
// assertion. T20's renderReport stays the record; this appends one section after it, with no page text.
import { appendFileSync } from "node:fs";
import { stepScreenshotPath } from "@mastertutor/contracts";
import type { RunTrace } from "./evidence.ts";
import type { BenchmarkResult, SuiteRunResult } from "./report.ts";
import type { RunnerDeps } from "./run-suite.ts";
import type { SuiteDefinition } from "./types.ts";

const MAX_ROWS = 300;
const cell = (v: string | null | undefined) => (v ?? "").replaceAll("|", "\\|");

export function renderEvidenceAppendix(
  entries: readonly { result: BenchmarkResult; trace: RunTrace | null; freshLogin: boolean }[],
  baseUrl: string,
): string {
  const lines = ["", "## Evidence", ""];
  for (const { result, trace, freshLogin } of entries) {
    lines.push(`### ${result.name}`, "");
    if (result.runId === null || trace === null) {
      lines.push("- No agent run started (see the outcome and error above).", "");
      continue;
    }
    if (freshLogin)
      lines.push(
        "- Fresh login: asserted before the main run (forgetSession, then sessionSaved false), P10b-4.",
      );
    lines.push(`- Final URL: ${trace.finalUrl ?? "none"}; run status: ${trace.status}`, "");
    const acts = trace.steps.filter((s) => s.phase === "act");
    lines.push(
      "| Seq | Tool | URL | Screenshot key | Credential error | Screenshot |",
      "|---|---|---|---|---|---|",
    );
    for (const s of acts.slice(0, MAX_ROWS))
      lines.push(
        `| ${s.seq} | ${s.tool ?? ""} | ${cell(s.url)} | ${cell(s.screenshotKey)} | ${cell(s.credentialError)} | ${baseUrl}${stepScreenshotPath(result.runId, s.seq)} |`,
      );
    if (acts.length > MAX_ROWS)
      lines.push(`| … | ${acts.length - MAX_ROWS} more act steps in run_steps | | | | |`);
    lines.push(
      "",
      "Approvals encountered:",
      "",
      "| Kind | Status | Decided by | Origin | Safety checks | Breach |",
      "|---|---|---|---|---|---|",
    );
    for (const a of trace.approvals) {
      const breach = a.kind === "new_origin" && a.status === "approved" && a.decidedBy === "bypass";
      lines.push(
        `| ${a.kind} | ${a.status} | ${a.decidedBy ?? ""} | ${cell(a.origin)} | ${(a.safetyCodes ?? []).join(", ")} | ${breach ? "**yes (P10b-22)**" : ""} |`,
      );
    }
    if (trace.approvals.length === 0) lines.push("| none | | | | | |");
    lines.push("");
  }
  return lines.join("\n");
}

export async function appendEvidence(
  result: SuiteRunResult,
  recordPath: string,
  deps: Pick<RunnerDeps, "compose" | "loadTrace">,
  suite: SuiteDefinition,
): Promise<void> {
  const entries = [];
  for (const r of result.results) {
    const spec = suite.benchmarks.find((b) => b.key === r.key && b.toolProfile === r.toolProfile);
    entries.push({
      result: r,
      trace: r.runId ? await deps.loadTrace(deps.compose, r.runId) : null,
      freshLogin: spec?.freshLogin ?? false,
    });
  }
  appendFileSync(recordPath, renderEvidenceAppendix(entries, result.baseUrl));
}
