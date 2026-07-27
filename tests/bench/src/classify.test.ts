import { describe, expect, it } from "vitest";
import { suggestFailureClass, type FailureSignals, type WatchSummary } from "./classify.ts";
import { computer, fill, observe, traceOf } from "./trace-fixtures.ts";

const verdict = {
  outcome: "failed" as const,
  summary: "",
  unmet: ["x"],
  unvisited: [] as string[],
};
const watch: WatchSummary = {
  budgetHit: false,
  stalled: false,
  humanWait: null,
  spendCapHit: false,
  safetyChecks: [],
  takeovers: 0,
};
const signals = (over: Partial<FailureSignals> = {}): FailureSignals => ({
  trace: traceOf([]),
  verdict,
  watch,
  ...over,
});

describe("suggestFailureClass", () => {
  it("policy: a denied new origin or a prompt-injection safety check", () => {
    const trace = traceOf([], {
      approvals: [
        {
          kind: "new_origin",
          status: "denied",
          decidedBy: "policy",
          origin: "https://x.example",
          safetyCodes: [],
        },
      ],
    });
    expect(suggestFailureClass(signals({ trace })).cls).toBe("policy");
    expect(
      suggestFailureClass(
        signals({ watch: { ...watch, safetyChecks: ["malicious_instructions"] } }),
      ).cls,
    ).toBe("policy");
  });
  it("auth: a credential error or ending on a sign-in page", () => {
    expect(
      suggestFailureClass(
        signals({ trace: traceOf([observe("https://x.test/a"), fill("origin_mismatch")]) }),
      ).cls,
    ).toBe("auth");
    expect(
      suggestFailureClass(signals({ trace: traceOf([], { finalUrl: "https://x.test/signin" }) }))
        .cls,
    ).toBe("auth");
  });
  it("budget: the run budget or the total spend cap was hit", () => {
    expect(suggestFailureClass(signals({ watch: { ...watch, budgetHit: true } })).cls).toBe(
      "budget",
    );
    expect(suggestFailureClass(signals({ watch: { ...watch, spendCapHit: true } })).cls).toBe(
      "budget",
    );
  });
  it("navigation: target pages never worked on", () => {
    expect(
      suggestFailureClass(signals({ verdict: { ...verdict, unvisited: ["https://x.test/s/1"] } }))
        .cls,
    ).toBe("navigation");
  });
  it("action: stalled or stuck waiting for a takeover", () => {
    expect(suggestFailureClass(signals({ watch: { ...watch, stalled: true } })).cls).toBe("action");
    expect(suggestFailureClass(signals({ watch: { ...watch, humanWait: "takeover" } })).cls).toBe(
      "action",
    );
  });
  it("perception otherwise, pointing at the last act with its inherited screenshot", () => {
    const first = observe("https://x.test/a");
    const trace = traceOf([first, computer({ type: "click", x: 1, y: 1, button: "left" })]);
    expect(suggestFailureClass(signals({ trace }))).toMatchObject({
      cls: "perception",
      step: { seq: 2, url: "https://x.test/a", screenshotKey: first.screenshotKey },
    });
  });
});
