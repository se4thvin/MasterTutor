import { describe, expect, it } from "vitest";
import {
  EMPTY_LEDGER,
  SwarmReport,
  citedEvidence,
  dismiss,
  extractSwarmReport,
  findingKey,
  markFixed,
  markVerified,
  mergeReports,
  openEntries,
  renderLedgerMarkdown,
  type FindingInput,
} from "./findings.ts";

const RUN_A = "2026-10-08-01-test-qa-swarm-g3";
const RUN_B = "2026-10-08-02-test-qa-swarm-g3";
const RUN_C = "2026-10-09-01-test-qa-swarm-g3";

const finding = (over: Partial<FindingInput> = {}): FindingInput => ({
  group: "G3",
  screen: "run-otp",
  width: 390,
  theme: "dark",
  category: "clipping",
  severity: "major",
  title: "Sixth OTP box clipped by the card",
  detail: "The 6th slot sits outside the card's padding box.",
  evidence: [`orchestration/runs/${RUN_A}/artifacts/shots/run-otp/w390-dark.png`],
  selector: "section.run-otp .cslots-slot:nth-child(6)",
  autoDetected: false,
  ...over,
});
const report = (...findings: FindingInput[]) =>
  SwarmReport.parse({
    group: "G3",
    agent: "layout",
    checked: [{ screen: "run-otp", width: 390, theme: "dark" }],
    findings,
  });

describe("findings ledger (Phase 8 Task 9)", () => {
  it("assigns sequential ids and dedupes one finding across runs by where it is, not its wording", () => {
    const first = mergeReports(EMPTY_LEDGER, [{ runId: RUN_A, report: report(finding()) }]);
    const second = mergeReports(first, [
      { runId: RUN_B, report: report(finding({ title: "OTP slot six is cut off" })) },
    ]);
    expect(first.entries.map((e) => e.id)).toEqual(["QA-001"]);
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]!.seenInRuns).toEqual([RUN_A, RUN_B]);
  });

  it("refuses to merge a run twice, so an old report cannot re-open verified findings (P8-31)", () => {
    const ledger = mergeReports(EMPTY_LEDGER, [{ runId: RUN_A, report: report(finding()) }]);
    expect(() => mergeReports(ledger, [{ runId: RUN_A, report: report(finding()) }])).toThrow(
      /already merged/,
    );
  });

  it("re-opens a fixed or verified finding that a later run reports again (a regression)", () => {
    let ledger = mergeReports(EMPTY_LEDGER, [{ runId: RUN_A, report: report(finding()) }]);
    ledger = markFixed(ledger, "QA-001", "abc1234");
    ledger = markVerified(ledger, "QA-001", RUN_B);
    ledger = mergeReports(ledger, [{ runId: RUN_C, report: report(finding()) }]);
    expect(ledger.entries[0]).toMatchObject({
      status: "open",
      fixCommit: null,
      verifiedInRun: null,
    });
  });

  it("keeps a dismissed finding dismissed and records the sighting (P8-24)", () => {
    let ledger = mergeReports(EMPTY_LEDGER, [{ runId: RUN_A, report: report(finding()) }]);
    ledger = dismiss(ledger, "QA-001", "Intended: the card scrolls horizontally at 390 by design.");
    ledger = mergeReports(ledger, [{ runId: RUN_B, report: report(finding()) }]);
    expect(ledger.entries[0]).toMatchObject({ status: "dismissed", seenInRuns: [RUN_A, RUN_B] });
    expect(openEntries(ledger)).toEqual([]);
  });

  it("rejects a finding with no evidence (a valid title, so the assertion is reached: P8-19)", () => {
    const parsed = SwarmReport.safeParse({
      group: "G3",
      agent: "layout",
      checked: [],
      findings: [finding({ evidence: [] })],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects evidence outside a QA run's directory", () => {
    for (const evidence of [
      "orchestration/runs/2026-10-08-01-test-qa-x/artifacts/../../../../.env",
      "orchestration/STATE.md",
      "/etc/passwd",
    ]) {
      expect(
        SwarmReport.safeParse({
          group: "G3",
          agent: "layout",
          checked: [],
          findings: [finding({ evidence: [evidence] })],
        }).success,
        evidence,
      ).toBe(false);
    }
  });

  it("verifies only a fixed finding and dismisses only with a rationale", () => {
    const ledger = mergeReports(EMPTY_LEDGER, [{ runId: RUN_A, report: report(finding()) }]);
    expect(() => markVerified(ledger, "QA-001", RUN_B)).toThrow(/must be fixed/);
    expect(() => dismiss(ledger, "QA-001", "no")).toThrow();
  });

  it("keys on group, screen, width, theme, category and selector", () => {
    expect(findingKey(finding())).toBe(
      findingKey(finding({ title: "Different words", severity: "minor" })),
    );
    expect(findingKey(finding())).not.toBe(findingKey(finding({ width: 820 })));
  });

  it("extracts exactly one json qa-report block from a persisted report.md", () => {
    const body = JSON.stringify(report(finding()));
    expect(
      extractSwarmReport(`# Report\n\n\`\`\`json qa-report\n${body}\n\`\`\`\n`).findings,
    ).toHaveLength(1);
    expect(() => extractSwarmReport("no block here")).toThrow(/exactly one/);
  });

  it("lists cited evidence and renders open findings first", () => {
    let ledger = mergeReports(EMPTY_LEDGER, [
      { runId: RUN_A, report: report(finding(), finding({ screen: "run-live", selector: null })) },
    ]);
    ledger = markFixed(ledger, "QA-001", "abc1234");
    expect(citedEvidence(ledger)).toContain(
      `orchestration/runs/${RUN_A}/artifacts/shots/run-otp/w390-dark.png`,
    );
    const md = renderLedgerMarkdown(ledger);
    expect(md.indexOf("QA-002")).toBeLessThan(md.indexOf("QA-001"));
  });
});
