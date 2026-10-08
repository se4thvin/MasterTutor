import { describe, expect, it } from "vitest";
import { renderEvidenceAppendix } from "./appendix.ts";
import type { RunTrace } from "./evidence.ts";
import type { BenchmarkResult } from "./report.ts";

const RUN = "6c1d2e3f-0a1b-4c2d-8e3f-405162738495";
const result = {
  name: "zybooks/login@browser_use:bypass#3f9a12c0",
  runId: RUN,
  outcome: "failed",
  verifyRunIds: [],
} as unknown as BenchmarkResult;
const trace: RunTrace = {
  runId: RUN,
  status: "completed",
  waitReason: null,
  finalUrl: "https://learn.zybooks.com/signin",
  steps: [
    {
      seq: 1,
      phase: "observe",
      state: "done",
      url: "https://learn.zybooks.com/signin",
      screenshotKey: "runs/k1.webp",
      caption: null,
      tool: null,
      interaction: false,
      readPage: null,
      credentialError: null,
    },
    {
      seq: 2,
      phase: "act",
      state: "done",
      url: "https://learn.zybooks.com/signin",
      screenshotKey: "runs/k1.webp",
      caption: null,
      tool: "fill_credential",
      interaction: false,
      readPage: null,
      credentialError: "field_not_found",
    },
  ],
  approvals: [
    {
      kind: "new_origin",
      status: "approved",
      decidedBy: "bypass",
      origin: "https://evil.test",
      safetyCodes: [],
    } as never,
  ],
};

describe("renderEvidenceAppendix (D46 record contents)", () => {
  it("lists act steps with URL and screenshot key, approvals (breach flagged), and the fresh-login assertion", () => {
    const text = renderEvidenceAppendix(
      [{ result, trace, freshLogin: true }],
      "http://localhost:18080",
    );
    expect(text).toContain("## Evidence");
    expect(text).toContain(
      `| 2 | fill_credential | https://learn.zybooks.com/signin | runs/k1.webp | field_not_found | http://localhost:18080/api/runs/${RUN}/steps/2/screenshot |`,
    );
    expect(text).toContain(
      "| new_origin | approved | bypass | https://evil.test |  | **yes (P10b-22)** |",
    );
    expect(text).toContain(
      "Fresh login: asserted before the main run (forgetSession, then sessionSaved false)",
    );
    expect(text).not.toContain("readPage");
  });
  it("says so when no run started", () => {
    expect(
      renderEvidenceAppendix(
        [{ result: { ...result, runId: null }, trace: null, freshLogin: true }],
        "http://x",
      ),
    ).toContain("No agent run started");
  });
});
