import { describe, expect, it } from "vitest";
import { buildGuardInput, targetRole, type GuardItemDraft } from "./input.ts";

const item: GuardItemDraft = {
  actionClass: "click",
  triggers: ["risky_item"],
  policyKind: "risky_click",
  policyDecision: "approved",
  target: {
    role: "button",
    formKind: null,
    isFormSubmit: false,
    isSecretField: false,
    opaqueFrame: false,
    hasDownload: false,
    formPostsTo: null,
  },
  destination: null,
  sent: null,
  vault: null,
  safetyChecks: [],
};
const run = {
  step: 1,
  newOrigins: 0,
  denials: { consecutive: 0, total: 0 },
  loopHits: 0,
  injectionSignals: 0,
  riskLevel: "normal",
} as const;

describe("buildGuardInput (spec §6.4)", () => {
  it("keys items i1…i20 in order and caps them at 20", () => {
    const input = buildGuardInput({
      goal: "Notes",
      mode: "bypass",
      allowedOrigins: [],
      page: { origin: "https://a.test", inAllowed: false },
      items: Array.from({ length: 25 }, () => item),
      run,
    });
    expect(input.items.map((i) => i.key)).toEqual(
      Array.from({ length: 20 }, (_, i) => `i${i + 1}`),
    );
  });
  it("scrubs links, emails and labelled secrets out of the goal", () => {
    const input = buildGuardInput({
      goal: "Log in as sam@example.test password: hunter2 at https://learn.example.com/x?token=abc",
      mode: "ask",
      allowedOrigins: [],
      page: { origin: null, inAllowed: false },
      items: [item],
      run,
    });
    expect(input.goal).not.toContain("sam@example.test");
    expect(input.goal).not.toContain("hunter2");
    expect(input.goal).not.toContain("token=abc");
  });
  it("refuses a draft that smuggles a page-derived field", () => {
    expect(() =>
      buildGuardInput({
        goal: "g",
        mode: "ask",
        allowedOrigins: [],
        page: { origin: null, inAllowed: false },
        items: [{ ...item, label: "Delete everything" } as GuardItemDraft],
        run,
      }),
    ).toThrow();
  });
  it("maps tags to roles and an opaque frame to frame", () => {
    expect(targetRole("A", false)).toBe("link");
    expect(targetRole("my-widget", false)).toBe("other");
    expect(targetRole("button", true)).toBe("frame");
  });
});
