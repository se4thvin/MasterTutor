import { describe, expect, it } from "vitest";
import {
  ApprovalDecisionInput,
  ApprovalRequest,
  AUTO_MODE_DECISIONS,
  decideByPolicy,
  decideSafetyChecks,
  isRiskyLabel,
} from "./approval.ts";
import { APPROVAL_KINDS, type ApprovalKind } from "./enums.ts";
import { DEFAULT_BUDGET, EMPTY_USAGE } from "./budget.ts";

describe("isRiskyLabel", () => {
  it.each([
    "Submit",
    "Pay now",
    "Proceed to payment",
    "Delete note",
    "Removing item",
    "Check out",
    "Confirm order",
    "Unsubscribe",
    "ＳＵＢＭＩＴ",
    "Sub\u200Bmit",
  ])("flags %j", (label) => {
    expect(isRiskyLabel(label)).toBe(true);
  });
  it.each(["Check", "Next", "Show answer", "Continue reading", "Search"])("allows %j", (label) => {
    expect(isRiskyLabel(label)).toBe(false);
  });
});

describe("ApprovalRequest", () => {
  it("has one variant per approval kind", () => {
    const samples: Record<ApprovalKind, unknown> = {
      risky_click: {
        kind: "risky_click",
        action: { type: "click", x: 1, y: 1 },
        label: "Submit",
        url: "https://learn.zybooks.com/x",
        screenshotKey: null,
      },
      form_submit: {
        kind: "form_submit",
        url: "https://a.com/f",
        formSummary: "Feedback form",
        screenshotKey: null,
      },
      download: { kind: "download", url: "https://a.com/f.pdf", filename: "f.pdf" },
      credential_first_use: {
        kind: "credential_first_use",
        alias: "zybooks",
        origin: "https://learn.zybooks.com",
      },
      new_origin: { kind: "new_origin", origin: "https://b.com", url: "https://b.com/page" },
      budget: { kind: "budget", exceeded: "usd", usage: EMPTY_USAGE, budget: DEFAULT_BUDGET },
    };
    for (const kind of APPROVAL_KINDS) {
      expect(ApprovalRequest.parse(samples[kind]).kind).toBe(kind);
    }
  });
});

describe("decideByPolicy", () => {
  it("asks for everything in ask mode", () => {
    for (const kind of APPROVAL_KINDS) expect(decideByPolicy("ask", kind)).toBe("ask");
  });
  it("auto mode approves in-allowlist work, blocks new origins and downloads, never spends more", () => {
    expect(decideByPolicy("auto_within_allowlist", "risky_click")).toBe("approved");
    expect(decideByPolicy("auto_within_allowlist", "form_submit")).toBe("approved");
    expect(decideByPolicy("auto_within_allowlist", "credential_first_use")).toBe("approved");
    expect(decideByPolicy("auto_within_allowlist", "new_origin")).toBe("denied");
    expect(decideByPolicy("auto_within_allowlist", "download")).toBe("denied");
    expect(decideByPolicy("auto_within_allowlist", "budget")).toBe("ask");
    expect(Object.keys(AUTO_MODE_DECISIONS).sort()).toEqual([...APPROVAL_KINDS].sort());
  });
});

describe("decideSafetyChecks", () => {
  const checks = (...codes: Array<string | null>) => codes.map((code) => ({ code }));
  it("always asks in ask mode", () => {
    expect(decideSafetyChecks("ask", checks("irrelevant_domain"), true)).toBe("ask");
  });
  it("auto-approves only irrelevant_domain on an allowed origin", () => {
    expect(decideSafetyChecks("auto_within_allowlist", checks("irrelevant_domain"), true)).toBe(
      "approved",
    );
    expect(decideSafetyChecks("auto_within_allowlist", checks("irrelevant_domain"), false)).toBe(
      "ask",
    );
  });
  it("never auto-clears injection, sensitive-domain, unknown or empty checks", () => {
    for (const list of [
      checks("malicious_instructions"),
      checks("sensitive_domain"),
      checks("something_new"),
      checks(null),
      checks("irrelevant_domain", "malicious_instructions"),
      [],
    ])
      expect(decideSafetyChecks("auto_within_allowlist", list, true)).toBe("ask");
  });
  it("marks a safety-check request on risky_click", () => {
    const request = ApprovalRequest.parse({
      kind: "risky_click",
      action: { type: "screenshot" },
      label: "Safety check",
      url: "http://a.test/",
      screenshotKey: null,
      safetyChecks: [{ code: "malicious_instructions", message: "x" }],
    });
    expect(request.kind === "risky_click" && request.safetyChecks).toEqual([
      { code: "malicious_instructions", message: "x" },
    ]);
  });
});

describe("ApprovalDecisionInput", () => {
  it("requires an instruction for edits", () => {
    const approvalId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(ApprovalDecisionInput.safeParse({ approvalId, decision: "edited" }).success).toBe(false);
    expect(
      ApprovalDecisionInput.parse({
        approvalId,
        decision: "edited",
        instruction: "Click Check first",
      }).instruction,
    ).toBe("Click Check first");
    expect(
      ApprovalDecisionInput.parse({ approvalId, decision: "approved" }).budgetChoice,
    ).toBeNull();
  });
});
