import { basename, dirname } from "node:path";
import { stepScreenshotPath, type ApprovalMode, type ToolProfile } from "@mastertutor/contracts";
import type { Failure, WatchSummary } from "./classify.ts";
import type { SectionOutcome, Verdict } from "./criteria.ts";
import type { StackName, SuiteId } from "./types.ts";

export interface BenchmarkResult {
  key: string;
  name: string;
  toolProfile: ToolProfile;
  approvalMode: ApprovalMode;
  attempt: number;
  benchmarkRunId: string | null;
  runId: string | null;
  verifyRunIds: string[];
  outcome: "passed" | "partial" | "failed" | "error";
  verdict: Verdict | null;
  /** Why the attempt has no grade (precondition, baseline, tainted verify, seam), else null. */
  error: string | null;
  metrics: { steps: number; usd: number; durationMs: number | null; takeovers: number };
  watch: WatchSummary | null;
  failure: Failure | null;
  bypassNewOrigins: string[];
  /** This attempt ran its own baseline and it passed (a later same-day run may reuse it, P10b-21). */
  baselinePassed: boolean;
  /** The record whose same-day passing baseline this attempt reused, else null. */
  baselineFrom: string | null;
  ticket: string | null;
}

export interface SuiteRunResult {
  suite: SuiteId;
  stack: StackName;
  baseUrl: string;
  mock: boolean;
  mode: "once" | "continue";
  continues: string | null;
  command: string;
  capUsd: number;
  maxRunUsd: number;
  spentBeforeUsd: number;
  spentAfterUsd: number;
  stopped: "spend_cap" | null;
  startedAt: string;
  finishedAt: string;
  results: BenchmarkResult[];
}

const duration = (ms: number | null) =>
  ms === null ? "–" : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
const cell = (text: string) => text.replaceAll("|", "\\|");
const usd = (n: number) => `$${n.toFixed(2)}`;
type Scalar = string | number | boolean | null;
/** Flat frontmatter: scalars and string lists, so a person can edit it by hand. */
export type RecordFields = Record<string, Scalar | string[]>;
export interface RecordSummary {
  id: string;
  path: string;
  fields: RecordFields;
}

const scalar = (v: Scalar) =>
  typeof v === "string" && /^[\w.@:/#+-]+$/.test(v) ? v : JSON.stringify(v);
export function renderFrontmatter(fields: RecordFields): string {
  const lines = Object.entries(fields).map(
    ([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(scalar).join(", ")}]` : scalar(v)}`,
  );
  return ["---", ...lines, "---"].join("\n");
}

function parseScalar(raw: string): Scalar {
  if (raw === "true" || raw === "false") return raw === "true";
  if (raw === "null" || raw === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('"')) return JSON.parse(raw) as string;
  return raw;
}

/** Reads the flat `key: value` frontmatter renderFrontmatter writes (and a person edits). Nothing else. */
export function readFrontmatter(text: string): RecordFields {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) throw new Error("record has no frontmatter");
  const fields: RecordFields = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const raw = kv[2]!.trim();
    fields[kv[1]!] = raw.startsWith("[")
      ? raw
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => String(parseScalar(s)))
      : parseScalar(raw);
  }
  return fields;
}

/**
 * D46 gate for every invocation after the first. `path` must name the newest record, or a record
 * whose later records it authorized. A person must have set `reviewed: true`, `reviewed_by` and
 * `authorize: N` (N >= 1 further invocations); each continued invocation writes a new record with
 * `authorized_by: <id>` and `authorize: 0`, using up one. Returns the authorizing record id.
 */
export function assertContinueAllowed(path: string, records: readonly RecordSummary[]): string {
  const target = records.find(
    (r) => r.path === path || r.path.endsWith(`/${path}`) || path.endsWith(r.path),
  );
  if (!target) throw new Error(`no record at ${path}`);
  const f = target.fields;
  if (f["reviewed"] !== true)
    throw new Error(
      `${target.id} is not reviewed: a person sets reviewed: true in its frontmatter (D46)`,
    );
  if (typeof f["reviewed_by"] !== "string" || f["reviewed_by"] === "")
    throw new Error(`${target.id} has no reviewed_by: the reviewer names themselves (D46)`);
  const after = records.filter((r) => r.id > target.id);
  if (after.some((r) => r.fields["authorized_by"] !== target.id))
    throw new Error(
      `${target.id} is not the newest record; continue from the newest reviewed record`,
    );
  const allowed = typeof f["authorize"] === "number" ? f["authorize"] : 0;
  if (after.length >= allowed)
    throw new Error(`${target.id} authorize: ${allowed} is used up; a new review is needed`);
  return target.id;
}

/** Every graded section: reading, URL, outcome and why (run 1's discovered readings). */
export function sectionTable(sections: readonly SectionOutcome[]): string[] {
  return [
    "| Reading | Section | URL | Outcome | Why |",
    "|---|---|---|---|---|",
    ...sections.map(
      (r) =>
        `| ${r.reading} | ${cell(r.title)} | ${r.url ?? "–"} | ${r.outcome === "passed" ? "passed" : `**${r.outcome}**`} | ${cell(r.reason)} |`,
    ),
  ];
}

export function renderFailureNotes(failure: Failure | null, verdict: Verdict | null): string {
  const summary = `verdict: ${verdict?.summary ?? "none"}`;
  if (failure === null) return summary;
  return [
    `class: ${failure.cls}`,
    `step: ${failure.step?.seq ?? "none"}`,
    `screenshot: ${failure.step?.screenshotKey ?? "none"}`,
    `reason: ${failure.reason}`,
    summary,
    ...(verdict?.unmet ?? []).slice(0, 10).map((u) => `unmet: ${u}`),
  ].join("\n");
}

function record(r: SuiteRunResult, x: BenchmarkResult): string[] {
  const step = x.failure?.step ?? null;
  return [
    `### ${x.name} (attempt ${x.attempt})`,
    "",
    `- Outcome: **${x.outcome}**${x.error ? ` (${x.error})` : ""}`,
    `- Approval mode: ${x.approvalMode}; track: ${x.toolProfile}`,
    `- Run: ${x.runId === null ? "none" : `\`${x.runId}\` (${r.baseUrl}/runs/${x.runId})`}; benchmark run: ${x.benchmarkRunId ?? "none"}`,
    `- Verify runs: ${x.verifyRunIds.map((v) => `\`${v}\``).join(", ") || "none"}`,
    `- Verdict: ${x.verdict?.summary ?? "none"}`,
    ...(x.verdict?.unmet ?? []).map((u) => `  - unmet: ${u}`),
    ...(x.verdict?.unvisited ?? []).map((u) => `  - never worked on: ${u}`),
    ...(x.verdict?.sections?.length ? ["", ...sectionTable(x.verdict.sections), ""] : []),
    `- Failure: ${x.failure ? `${x.failure.cls}: ${x.failure.reason}` : "none"}${x.ticket ? ` (${x.ticket})` : ""}`,
    ...(step && x.runId
      ? [
          `- Failing step: ${step.seq} at ${step.url ?? "unknown url"}`,
          `- Screenshot: ${step.screenshotKey ?? "none"} (${r.baseUrl}${stepScreenshotPath(x.runId, step.seq)})`,
        ]
      : []),
    ...(x.watch
      ? [
          `- Watch: budget hit ${x.watch.budgetHit}, spend cap hit ${x.watch.spendCapHit}, stalled ${x.watch.stalled}, human wait ${x.watch.humanWait ?? "none"}, takeovers ${x.watch.takeovers}`,
          `- Safety checks: ${x.watch.safetyChecks.join(", ") || "none"}`,
          `- Safety checks auto_approved (decided_by=bypass/policy): ${x.watch.autoApprovedSafetyChecks.join(", ") || "none"}`,
        ]
      : []),
    ...x.bypassNewOrigins.map((o) => `- **BREACH: new origin approved in bypass: ${o}**`),
    "",
  ];
}

export function renderReport(r: SuiteRunResult, reportPath: string): string {
  const rows = r.results.map(
    (x) =>
      `| ${x.name} | ${x.toolProfile} | ${x.approvalMode} | ${x.outcome} | ${x.metrics.steps} | ${usd(x.metrics.usd)} | ${duration(x.metrics.durationMs)} | ${x.metrics.takeovers} | ${x.failure ? `${x.failure.cls}${x.ticket ? ` (${x.ticket})` : ""}` : "–"} |`,
  );
  return [
    renderFrontmatter({
      record: basename(dirname(reportPath)),
      report: reportPath,
      suite: r.suite,
      stack: r.stack,
      mode: r.mode,
      mock: r.mock,
      continues: r.continues,
      cap_usd: r.capUsd,
      max_run_usd: r.maxRunUsd,
      spent_before_usd: Number(r.spentBeforeUsd.toFixed(2)),
      spent_after_usd: Number(r.spentAfterUsd.toFixed(2)),
      spend_total_usd: Number((r.spentAfterUsd - r.spentBeforeUsd).toFixed(2)),
      stopped: r.stopped,
      // P10b-21: spec names whose own baseline passed here, and the records whose baselines were reused.
      baselines_passed: r.results.filter((x) => x.baselinePassed).map((x) => x.name),
      baseline_from: [
        ...new Set(r.results.flatMap((x) => (x.baselineFrom ? [x.baselineFrom] : []))),
      ],
      created: r.finishedAt,
      // D46 review gate (field names shared with 07's T23 record): a person flips reviewed, names
      // themselves, and sets how many further invocations this review authorizes.
      reviewed: false,
      reviewed_by: null,
      authorize: 0,
      authorized_by: r.continues,
      // What `pnpm bench regrade` re-reads (I5): per result, its spec, main run and grading run.
      specs: r.results.map((x) => `${x.key}@${x.toolProfile}`),
      run_ids: r.results.map((x) => x.runId ?? "none"),
      grading_run_ids: r.results.map((x) => x.verifyRunIds.at(-1) ?? "none"),
      takeovers: r.results.map((x) => String(x.metrics.takeovers)),
    }),
    "",
    `# Benchmark record: ${r.suite}`,
    "",
    `- Stack: ${r.stack}${r.mock ? " (llm-mock: harness test only)" : " (real model)"}`,
    `- Command: \`pnpm bench ${r.command}\``,
    `- Window: ${r.startedAt} → ${r.finishedAt}`,
    `- Spend: ${usd(r.spentBeforeUsd)} → ${usd(r.spentAfterUsd)} of the ${usd(r.capUsd)} cap; per-run budget ${usd(r.maxRunUsd)}`,
    ...(r.stopped ? [`- **Stopped: ${r.stopped}**`] : []),
    "",
    "| Benchmark | Track | Mode | Outcome | Steps | Cost | Duration | Takeovers | Failure |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Records",
    "",
    ...r.results.flatMap((x) => record(r, x)),
    "## Next",
    "",
    "The harness stopped here. Nothing else runs until a person reviews this record (D46).",
    "After review, set `reviewed: true`, `reviewed_by: <name>` and `authorize: N` (N >= 1) in the frontmatter above. Each continued invocation uses one authorization. Continue with:",
    "",
    `\`pnpm bench run --suite ${r.suite} --continue-after-review ${reportPath} …\``,
    "",
  ].join("\n");
}

export function renderTicket(
  id: string,
  x: BenchmarkResult,
  reportPath: string,
  created: string,
): string {
  return [
    renderFrontmatter({
      ticket: id,
      status: "open",
      benchmark: x.name,
      track: x.toolProfile,
      run_id: x.runId,
      verify_run_ids: x.verifyRunIds,
      report: reportPath,
      created,
    }),
    "",
    `# ${id}: ${x.name} — ${x.failure?.cls ?? x.outcome}`,
    "",
    `- Outcome: ${x.outcome}${x.error ? ` (${x.error})` : ""}`,
    `- Failing step: ${x.failure?.step?.seq ?? "none"} at ${x.failure?.step?.url ?? "none"}`,
    `- Screenshot key: ${x.failure?.step?.screenshotKey ?? "none"}`,
    `- Suggested class: ${x.failure?.cls ?? "unknown"}: ${x.failure?.reason ?? ""}`,
    "",
    "## Unmet",
    "",
    ...((x.verdict?.unmet.length ?? 0) > 0
      ? x.verdict!.unmet.map((u) => `- ${u}`)
      : ["- none recorded"]),
    "",
    "## Orchestrator triage",
    "",
    "- Confirmed class (perception / action / navigation / auth / policy / budget):",
    "- What the agent saw vs. did (cite the replay steps):",
    "- Generic root cause in product code (no site-specific fix):",
    "",
    "## Fix acceptance",
    "",
    "- [ ] A failing test reproduces the cause on a fixture or in a unit test",
    "- [ ] The fix landed through the normal review (commit sha below)",
    "- [ ] Gates green: test, test:int, test:security, typecheck, lint, bench-mock (remote), e2e when web changed",
    `- [ ] A reviewed re-run of \`${x.key}\` (${x.toolProfile}) no longer fails this way`,
    "",
  ].join("\n");
}
