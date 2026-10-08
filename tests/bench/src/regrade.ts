// `pnpm bench regrade <record>` (I5): grade a finished invocation again from the traces its runs left
// in run_steps, with the suite's current criteria (for example corrected discovery patterns). It reads
// the stack's database only: no agent run, no model call, no spend. The result is appended to the
// record; the original grade above it stays as it was.
import { appendFileSync, readFileSync } from "node:fs";
import { baselineCriterion, evaluate, finalOutcome, verifyTainted } from "./criteria.ts";
import { readFrontmatter, sectionTable } from "./report.ts";
import { gradeTraces, type RunnerDeps } from "./run-suite.ts";
import type { SuiteDefinition } from "./types.ts";

const list = (value: unknown): string[] | null => (Array.isArray(value) ? value.map(String) : null);

export async function regradeRecord(
  recordPath: string,
  suite: SuiteDefinition,
  deps: Pick<RunnerDeps, "compose" | "loadTrace">,
  now: () => string,
): Promise<string> {
  const fields = readFrontmatter(readFileSync(recordPath, "utf8"));
  const specs = list(fields["specs"]);
  const runIds = list(fields["run_ids"]);
  const gradingIds = list(fields["grading_run_ids"]);
  const takeovers = list(fields["takeovers"]);
  if (
    !specs ||
    !runIds ||
    !gradingIds ||
    !takeovers ||
    [runIds, gradingIds, takeovers].some((l) => l.length !== specs.length)
  )
    throw new Error(
      `${recordPath} does not list its specs, run_ids, grading_run_ids and takeovers; it cannot be re-graded`,
    );
  const lines = [
    "",
    `## Regrade (${now()})`,
    "",
    "Graded again from the stored traces with the current suite definition; no run started, nothing spent.",
    "",
  ];
  for (const [i, key] of specs.entries()) {
    lines.push(`### ${key}`, "");
    const spec = suite.benchmarks.find((b) => `${b.key}@${b.toolProfile}` === key);
    if (!spec) {
      lines.push(`- Not re-graded: ${key} is no longer in the ${suite.id} suite.`, "");
      continue;
    }
    const runId = runIds[i]!;
    const gradingId = gradingIds[i]!;
    // A baseline invocation's only run is its grading run: it checks completion, not the main run's work.
    const baseline = runId !== "none" && runId === gradingId;
    const main = runId !== "none" && !baseline ? await deps.loadTrace(deps.compose, runId) : null;
    const grading = gradingId !== "none" ? await deps.loadTrace(deps.compose, gradingId) : null;
    const verdict = baseline
      ? evaluate(baselineCriterion(spec.criterion), null, grading)
      : gradeTraces(spec, main, grading);
    const tainted =
      grading !== null &&
      spec.verify !== null &&
      verifyTainted(grading, spec.verify.signInUrl, spec.criterion);
    // The same rule as the original grade (re-review N2): a run that needed a takeover never passes.
    const taken = Number(takeovers[i]);
    const outcome = tainted ? "error" : finalOutcome(verdict, taken);
    const why = tainted
      ? " (the grading run acted on a page other than the sign-in page)"
      : taken > 0
        ? ` (${taken} takeover${taken === 1 ? "" : "s"}: a run that needed a takeover never passes)`
        : "";
    lines.push(
      `- Outcome: **${outcome}**${why}`,
      `- Runs re-read: main ${baseline ? "none (baseline)" : runId}; grading ${gradingId}`,
      `- Verdict: ${verdict.summary}`,
      ...verdict.unmet.map((u) => `  - unmet: ${u}`),
      ...(verdict.sections?.length ? ["", ...sectionTable(verdict.sections)] : []),
      "",
    );
  }
  const text = lines.join("\n");
  appendFileSync(recordPath, text);
  return text;
}
