import { QA_VIEWPORTS } from "../../helpers/breakpoints.ts";
import { z } from "zod";

/** orchestration/README.md run ids, phase `test`, slug `qa-…` (P8-21). */
export const QA_RUN_ID = /^\d{4}-\d{2}-\d{2}-\d{2}-test-qa-[a-z0-9-]+$/;
const RunId = z.string().regex(QA_RUN_ID);

export const QA_GROUPS = [
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "INTERACTIVE",
  "MOTION",
  "AUTO",
  "CARRYOVER",
  "SAFARI",
] as const;
export const FINDING_CATEGORIES = [
  "alignment",
  "overflow",
  "clipping",
  "wrapping",
  "contrast",
  "overlap",
  "target-size",
  "a11y",
  "motion",
  "flake",
  "other",
] as const;
const QA_WIDTHS: readonly number[] = QA_VIEWPORTS.map((vp) => vp.width);
const Theme = z.enum(["light", "dark"]);

/** Evidence lives inside a QA run: its report.md, or a file under its artifacts/ (P8-21). */
const EVIDENCE =
  /^orchestration\/runs\/\d{4}-\d{2}-\d{2}-\d{2}-test-qa-[a-z0-9-]+\/(?:report\.md|artifacts\/[\w.-]+(?:\/[\w.-]+)*\.(?:png|json|webm|mp4|gif|txt|log))$/;
const Evidence = z
  .string()
  .max(300)
  .regex(EVIDENCE)
  .refine((path) => !path.split("/").includes(".."), "no parent segments");

export const FindingInput = z.strictObject({
  group: z.enum(QA_GROUPS),
  screen: z.string().min(1).max(80),
  width: z
    .number()
    .int()
    .refine((w) => QA_WIDTHS.includes(w), "a QA width (QA_VIEWPORTS)")
    .nullable(),
  theme: Theme.nullable(),
  category: z.enum(FINDING_CATEGORIES),
  severity: z.enum(["blocker", "major", "minor"]),
  title: z.string().min(3).max(160),
  detail: z.string().max(4_000),
  evidence: z.array(Evidence).min(1).max(20),
  selector: z.string().max(400).nullable(),
  autoDetected: z.boolean(),
});
export type FindingInput = z.infer<typeof FindingInput>;

/** One place a run looked at; a null width or theme means every one. */
const Checked = z.strictObject({
  screen: z.string().min(1).max(80),
  width: z.number().int().nullable(),
  theme: Theme.nullable(),
});
type Checked = z.infer<typeof Checked>;

export const SwarmReport = z.strictObject({
  group: z.enum(QA_GROUPS),
  agent: z.enum(["layout", "interactive", "animation", "orchestrator"]),
  checked: z.array(Checked).max(1_000),
  findings: z.array(FindingInput).max(500),
});
export type SwarmReport = z.infer<typeof SwarmReport>;

export const LedgerEntry = z
  .strictObject({
    id: z.string().regex(/^QA-\d{3,}$/),
    status: z.enum(["open", "fixed", "verified", "dismissed"]),
    finding: FindingInput,
    firstSeenInRun: RunId,
    seenInRuns: z.array(RunId).min(1),
    fixCommit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .nullable(),
    verifiedInRun: RunId.nullable(),
    /** How many runs the ledger had merged when this was fixed: a verifying run comes later (I4). */
    fixedAfterRuns: z.number().int().min(0).nullable(),
    rationale: z.string().trim().min(10).max(1_000).nullable(),
  })
  .superRefine((e, ctx) => {
    if ((e.status === "fixed" || e.status === "verified") && e.fixedAfterRuns === null)
      ctx.addIssue({
        code: "custom",
        message: `${e.id}: a fixed finding records when it was fixed`,
      });
    if ((e.status === "fixed" || e.status === "verified") && e.fixCommit === null)
      ctx.addIssue({ code: "custom", message: `${e.id}: a fixed finding names its commit` });
    if (e.status === "verified" && e.verifiedInRun === null)
      ctx.addIssue({ code: "custom", message: `${e.id}: a verified finding names its run` });
    if (e.status === "dismissed" && e.rationale === null)
      ctx.addIssue({ code: "custom", message: `${e.id}: a dismissal needs a rationale` });
  });
export type LedgerEntry = z.infer<typeof LedgerEntry>;

/** Each merged run, in merge order, with the places it checked (the evidence for a verify, I4). */
const MergedRun = z.strictObject({ runId: RunId, checked: z.array(Checked) });
export const Ledger = z.strictObject({
  mergedRuns: z.array(MergedRun),
  entries: z.array(LedgerEntry),
});
export type Ledger = z.infer<typeof Ledger>;
export const EMPTY_LEDGER: Ledger = { mergedRuns: [], entries: [] };

const norm = (text: string | null) => (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
/** Where the defect is, never how it was worded (P8-24). */
export function findingKey(f: FindingInput): string {
  return [f.group, f.screen, f.width ?? "*", f.theme ?? "*", f.category, norm(f.selector)].join(
    "|",
  );
}

/** One shooter shot's detector output (shoot.ts writes these per screen, width and theme). */
export interface Shot {
  screen: string;
  width: number;
  theme: "light" | "dark";
  layout: readonly string[];
  axe: readonly string[];
  /** "did not open: …", "server error: HTTP 5xx …" or "page error: …" (QA-041). */
  errors: readonly string[];
}
type Source = "layout" | "axe" | "error";
const SOURCE_DETAIL: Record<Source, string> = {
  layout: "fe's layout detector",
  axe: "axe (serious or critical)",
  error: "the shooter",
};

const CATEGORY_BY_PREFIX: readonly [RegExp, (typeof FINDING_CATEGORIES)[number]][] = [
  [/^target smaller/, "target-size"],
  [/^wraps onto/, "wrapping"],
  [/^overlaps/, "overlap"],
  [/^(clipped by|text clipped)/, "clipping"],
  [/^(text overflows|page scrolls|starts before)/, "overflow"],
];

/** The issue without its measurements, which change with the width and between rounds. */
const stableIssue = (issue: string) =>
  issue
    .replace(/\s*\([^)]*\d[^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

/**
 * The shooter's detector, axe and error output as findings with stable keys (I5): one per issue and
 * screen; `selector` is the issue without its measurements; `width`/`theme` are null when the
 * issue shows at more than one. The swarm agent copies these verbatim, never re-words them.
 */
export function autoFindings(
  group: (typeof QA_GROUPS)[number],
  runId: string,
  shots: readonly Shot[],
): FindingInput[] {
  const found = new Map<string, { issue: string; source: Source; shots: Shot[] }>();
  for (const shot of shots) {
    for (const [issues, source] of [
      [shot.layout, "layout"],
      [shot.axe, "axe"],
      [shot.errors, "error"],
    ] as const) {
      for (const issue of issues) {
        const key = `${shot.screen}\n${stableIssue(issue)}`;
        const entry = found.get(key) ?? { issue, source, shots: [] };
        entry.shots.push(shot);
        found.set(key, entry);
      }
    }
  }
  const only = <T>(values: readonly T[]) => (new Set(values).size === 1 ? values[0]! : null);
  return [...found.values()].map(({ issue, source, shots: seen }) => {
    const category =
      source === "axe"
        ? issue.startsWith("color-contrast")
          ? "contrast"
          : "a11y"
        : source === "error"
          ? "other"
          : (CATEGORY_BY_PREFIX.find(([prefix]) => prefix.test(issue))?.[1] ?? "other");
    const severity = issue.startsWith("did not open")
      ? "blocker"
      : category === "target-size"
        ? "minor"
        : "major";
    // A screen that failed may have no PNG; its JSON is always written.
    const ext = source === "error" ? "json" : "png";
    return FindingInput.parse({
      group,
      screen: seen[0]!.screen,
      width: only(seen.map((s) => s.width)),
      theme: only(seen.map((s) => s.theme)),
      category,
      severity,
      title: issue.slice(0, 160),
      detail: `${SOURCE_DETAIL[source]}: ${issue}`.slice(0, 4_000),
      evidence: seen
        .slice(0, 20)
        .map(
          (s) =>
            `orchestration/runs/${runId}/artifacts/shots/${s.screen}/w${s.width}-${s.theme}.${ext}`,
        ),
      selector: stableIssue(issue),
      autoDetected: true,
    });
  });
}

/** A swarm agent's final reply carries its report as one ```json qa-report block (P8-21). */
export function extractSwarmReport(markdown: string): SwarmReport {
  const blocks = [...markdown.matchAll(/```json qa-report\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one \`\`\`json qa-report block, found ${blocks.length}`);
  }
  return SwarmReport.parse(JSON.parse(blocks[0]![1]!));
}

export function mergeReports(
  ledger: Ledger,
  reports: readonly { runId: string; report: SwarmReport }[],
): Ledger {
  const runIds = reports.map((r) => RunId.parse(r.runId));
  const again = runIds.filter(
    (id, i) => ledger.mergedRuns.some((m) => m.runId === id) || runIds.indexOf(id) !== i,
  );
  if (again.length > 0) {
    throw new Error(
      `already merged: ${[...new Set(again)].join(", ")} (merge only this round's runs)`,
    );
  }
  const entries = ledger.entries.map((e) => ({ ...e, seenInRuns: [...e.seenInRuns] }));
  const byKey = new Map(entries.map((e) => [findingKey(e.finding), e]));
  let max = entries.reduce((m, e) => Math.max(m, Number(e.id.slice(3))), 0);
  for (const { runId, report } of reports) {
    for (const finding of report.findings) {
      const key = findingKey(finding);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.seenInRuns.includes(runId)) existing.seenInRuns.push(runId);
        // Seen again after a fix: a regression. A dismissal is a recorded decision and stands.
        if (existing.status === "fixed" || existing.status === "verified") {
          Object.assign(existing, {
            status: "open",
            finding,
            fixCommit: null,
            verifiedInRun: null,
            fixedAfterRuns: null,
          });
        }
        continue;
      }
      const entry: LedgerEntry = {
        id: `QA-${String(++max).padStart(3, "0")}`,
        status: "open",
        finding,
        firstSeenInRun: runId,
        seenInRuns: [runId],
        fixCommit: null,
        verifiedInRun: null,
        fixedAfterRuns: null,
        rationale: null,
      };
      entries.push(entry);
      byKey.set(key, entry);
    }
  }
  const merged = reports.map(({ runId, report }) => ({ runId, checked: report.checked }));
  return Ledger.parse({ mergedRuns: [...ledger.mergedRuns, ...merged], entries });
}

function update(
  ledger: Ledger,
  id: string,
  change: (e: LedgerEntry) => Partial<LedgerEntry>,
): Ledger {
  const entry = ledger.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`unknown finding ${id}`);
  return Ledger.parse({
    ...ledger,
    entries: ledger.entries.map((e) => (e.id === id ? { ...e, ...change(e) } : e)),
  });
}

export const markFixed = (ledger: Ledger, id: string, commit: string): Ledger =>
  update(ledger, id, (e) => {
    if (e.status !== "open") throw new Error(`${id} is ${e.status}, not open`);
    return { status: "fixed", fixCommit: commit, fixedAfterRuns: ledger.mergedRuns.length };
  });

const covers = (check: Checked, f: FindingInput) =>
  check.screen === f.screen &&
  (check.width === null || f.width === null || check.width === f.width) &&
  (check.theme === null || f.theme === null || check.theme === f.theme);

/**
 * fixed → verified, only on evidence (I4): `runId` was merged after the fix and re-checked the
 * finding's screen, width and theme without reporting it again (a re-report re-opens it on merge).
 */
export const markVerified = (ledger: Ledger, id: string, runId: string): Ledger =>
  update(ledger, id, (e) => {
    if (e.status !== "fixed") throw new Error(`${id} must be fixed before it is verified`);
    const at = ledger.mergedRuns.findIndex((m) => m.runId === runId);
    if (at === -1) throw new Error(`${runId} is not merged; merge its report first`);
    if (at < (e.fixedAfterRuns ?? Number.POSITIVE_INFINITY)) {
      throw new Error(`${runId} was merged before the fix of ${id}`);
    }
    if (!ledger.mergedRuns[at]!.checked.some((check) => covers(check, e.finding))) {
      throw new Error(`${runId} did not re-check ${e.finding.screen} for ${id}`);
    }
    return { status: "verified", verifiedInRun: RunId.parse(runId) };
  });

export const dismiss = (ledger: Ledger, id: string, rationale: string): Ledger =>
  update(ledger, id, (e) => {
    if (e.status === "verified") throw new Error(`${id} is verified; nothing to dismiss`);
    return { status: "dismissed", rationale };
  });

export const openEntries = (ledger: Ledger): LedgerEntry[] =>
  ledger.entries.filter((e) => e.status !== "verified" && e.status !== "dismissed");

/** Evidence the ledger cites: the only shots that are committed (P8-34). */
export const citedEvidence = (ledger: Ledger): string[] =>
  [...new Set(ledger.entries.flatMap((e) => e.finding.evidence))].sort();

export function renderLedgerMarkdown(ledger: Ledger): string {
  const order = { open: 0, fixed: 1, dismissed: 2, verified: 3 } as const;
  const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
  const rows = [...ledger.entries]
    .sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id))
    .map((e) => {
      const f = e.finding;
      const where = `${f.screen} ${f.width ?? "all"} ${f.theme ?? "both"}`;
      const note = e.status === "dismissed" ? cell(e.rationale ?? "") : (e.fixCommit ?? "");
      return `| ${e.id} | ${e.status} | ${f.severity} | ${f.group} | ${where} | ${f.category} | ${cell(f.title)} | ${f.evidence[0]} | ${note} |`;
    });
  return [
    "# QA findings ledger",
    "",
    `Open or unverified: **${openEntries(ledger).length}**. Exit requires zero (spec §12, D22, D28).`,
    `Merged runs: ${ledger.mergedRuns.length}.`,
    "",
    "| ID | Status | Severity | Group | Where | Category | Title | Evidence | Fix / rationale |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
