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

export const SwarmReport = z.strictObject({
  group: z.enum(QA_GROUPS),
  agent: z.enum(["layout", "interactive", "animation", "orchestrator"]),
  checked: z
    .array(
      z.strictObject({
        screen: z.string().min(1).max(80),
        width: z.number().int().nullable(),
        theme: Theme.nullable(),
      }),
    )
    .max(1_000),
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
    rationale: z.string().trim().min(10).max(1_000).nullable(),
  })
  .superRefine((e, ctx) => {
    if ((e.status === "fixed" || e.status === "verified") && e.fixCommit === null)
      ctx.addIssue({ code: "custom", message: `${e.id}: a fixed finding names its commit` });
    if (e.status === "verified" && e.verifiedInRun === null)
      ctx.addIssue({ code: "custom", message: `${e.id}: a verified finding names its run` });
    if (e.status === "dismissed" && e.rationale === null)
      ctx.addIssue({ code: "custom", message: `${e.id}: a dismissal needs a rationale` });
  });
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const Ledger = z.strictObject({ mergedRuns: z.array(RunId), entries: z.array(LedgerEntry) });
export type Ledger = z.infer<typeof Ledger>;
export const EMPTY_LEDGER: Ledger = { mergedRuns: [], entries: [] };

const norm = (text: string | null) => (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
/** Where the defect is, never how it was worded (P8-24). */
export function findingKey(f: FindingInput): string {
  return [f.group, f.screen, f.width ?? "*", f.theme ?? "*", f.category, norm(f.selector)].join(
    "|",
  );
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
    (id, i) => ledger.mergedRuns.includes(id) || runIds.indexOf(id) !== i,
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
        rationale: null,
      };
      entries.push(entry);
      byKey.set(key, entry);
    }
  }
  return Ledger.parse({ mergedRuns: [...ledger.mergedRuns, ...runIds], entries });
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
    return { status: "fixed", fixCommit: commit };
  });

export const markVerified = (ledger: Ledger, id: string, runId: string): Ledger =>
  update(ledger, id, (e) => {
    if (e.status !== "fixed") throw new Error(`${id} must be fixed before it is verified`);
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
