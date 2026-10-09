import { describe, expect, it } from "vitest";
import {
  ApprovalDecisionInput,
  ApprovalRequest,
  AUTO_MODE_DECISIONS,
  decideByPolicy,
  decideOnModeChange,
  decideSafetyChecks,
  isPersonDecider,
  policyDecider,
  isRiskyLabel,
} from "./approval.ts";
import { APPROVAL_KINDS, APPROVAL_MODES, type ApprovalKind } from "./enums.ts";
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

describe("bypass mode (D44)", () => {
  it("approves every action approval, records it as bypass, and still asks at a budget hit", () => {
    for (const kind of APPROVAL_KINDS)
      expect(decideByPolicy("bypass", kind)).toBe(kind === "budget" ? "ask" : "approved");
    expect(policyDecider("bypass")).toBe("bypass");
    expect(policyDecider("auto_within_allowlist")).toBe("policy");
  });
  it("is never a person's decision", () => {
    expect(isPersonDecider("bypass")).toBe(false);
    expect(isPersonDecider("policy")).toBe(false);
    expect(isPersonDecider(null)).toBe(false);
    expect(isPersonDecider("6f2c8a3e-0000-4000-8000-000000000000")).toBe(true);
  });
  it("clears domain checks on any origin, never a prompt-injection, unknown or empty check", () => {
    const checks = (...codes: Array<string | null>) => codes.map((code) => ({ code }));
    expect(
      decideSafetyChecks("bypass", checks("irrelevant_domain", "sensitive_domain"), false),
    ).toBe("approved");
    for (const list of [
      checks("malicious_instructions"),
      checks("irrelevant_domain", "malicious_instructions"),
      checks("something_new"),
      checks(null),
      [],
    ])
      expect(decideSafetyChecks("bypass", list, true)).toBe("ask");
  });
});

describe("decideOnModeChange (run-mode: a pending card when the mode changes mid-run)", () => {
  const url = "https://a.example/x";
  const click = (safetyChecks?: Array<{ code: string | null; message: string | null }>) =>
    ApprovalRequest.parse({
      kind: "risky_click",
      action: { type: "click", x: 1, y: 2, button: "left" },
      label: "Delete",
      url,
      screenshotKey: null,
      ...(safetyChecks ? { safetyChecks } : {}),
    });
  const pending = (request: ApprovalRequest, personOnly = false) => ({ request, personOnly });
  const check = (code: string) => [{ code, message: null }];

  it("switching to ask never resolves anything", () => {
    expect(decideOnModeChange("ask", pending(click()), true)).toBe("ask");
    expect(
      decideOnModeChange(
        "ask",
        pending({ kind: "new_origin", origin: "https://b.example", url }),
        true,
      ),
    ).toBe("ask");
  });

  it("auto and bypass re-decide with that mode's policy", () => {
    expect(decideOnModeChange("auto_within_allowlist", pending(click()), true)).toBe("approved");
    expect(decideOnModeChange("bypass", pending(click()), false)).toBe("approved");
    const origin = { kind: "new_origin", origin: "https://b.example", url } as const;
    expect(decideOnModeChange("auto_within_allowlist", pending(origin), true)).toBe("denied");
    expect(decideOnModeChange("bypass", pending(origin), true)).toBe("approved");
    const download = { kind: "download", url, filename: "a.pdf" } as const;
    expect(decideOnModeChange("auto_within_allowlist", pending(download), true)).toBe("denied");
    expect(decideOnModeChange("bypass", pending(download), true)).toBe("approved");
  });

  it("safety checks follow decideSafetyChecks: prompt injection always stays with a person", () => {
    const injection = pending(click(check("malicious_instructions")));
    for (const mode of APPROVAL_MODES)
      expect(decideOnModeChange(mode, injection, true)).toBe("ask");
    const irrelevant = pending(click(check("irrelevant_domain")));
    expect(decideOnModeChange("auto_within_allowlist", irrelevant, true)).toBe("approved");
    expect(decideOnModeChange("auto_within_allowlist", irrelevant, false)).toBe("ask");
    expect(decideOnModeChange("bypass", pending(click(check("sensitive_domain"))), false)).toBe(
      "approved",
    );
  });

  it("a budget hit still waits for a person in every mode", () => {
    const budget = pending({
      kind: "budget",
      exceeded: "usd",
      usage: EMPTY_USAGE,
      budget: DEFAULT_BUDGET,
    });
    for (const mode of APPROVAL_MODES) expect(decideOnModeChange(mode, budget, true)).toBe("ask");
  });

  it("never auto-resolves a person-only decision: a sign-in card or a card sent to a person", () => {
    const onOrigin = {
      kind: "credential_first_use",
      alias: "uni",
      origin: "https://a.example",
    } as const;
    const offOrigin = { ...onOrigin, postsTo: "https://evil.example/collect" };
    for (const mode of APPROVAL_MODES) {
      expect(decideOnModeChange(mode, pending(onOrigin), true)).toBe("ask");
      expect(decideOnModeChange(mode, pending(offOrigin), true)).toBe("ask");
      expect(decideOnModeChange(mode, pending(click(), true), true)).toBe("ask");
    }
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

describe("approval request display fields (run view A2, A3a)", () => {
  const click = { type: "click", x: 1, y: 2, button: "left" } as const;
  const risky = {
    kind: "risky_click",
    action: click,
    label: "Delete",
    url: "https://a.com/",
    screenshotKey: null,
  } as const;
  it("carries an optional record excerpt on risky clicks, capped at 240 characters", () => {
    expect(ApprovalRequest.parse({ ...risky, context: "Alice" })).toMatchObject({
      context: "Alice",
    });
    expect(ApprovalRequest.parse(risky)).not.toHaveProperty("context");
    expect(ApprovalRequest.safeParse({ ...risky, context: "x".repeat(241) }).success).toBe(false);
  });
  it("lets a form submit name the action that triggers it, and keeps old rows valid", () => {
    const form = {
      kind: "form_submit",
      url: "https://a.com/",
      formSummary: "Press Enter in a form",
      screenshotKey: null,
    } as const;
    expect(
      ApprovalRequest.parse({
        ...form,
        action: { type: "keypress", keys: ["ENTER"] },
        context: null,
      }),
    ).toMatchObject({ action: { type: "keypress" }, context: null });
    expect(ApprovalRequest.safeParse(form).success).toBe(true);
  });
});
