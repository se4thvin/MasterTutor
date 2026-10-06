import { describe, expect, it } from "vitest";
import type { TargetDescription } from "../browser/page-helpers.ts";
import { approvalRequestFor, needsApproval } from "./policy.ts";

const target = (overrides: Partial<TargetDescription>): TargetDescription => ({
  label: "",
  tag: "button",
  path: "button",
  isFormSubmit: false,
  formKind: null,
  isSecretField: false,
  editable: false,
  interactive: true,
  ...overrides,
});
const click = { type: "click" as const, x: 10, y: 10, button: "left" as const };

describe("needsApproval (spec §5.5)", () => {
  it("flags risky labels and non-login, non-search form submits", () => {
    expect(needsApproval(click, target({ label: "Delete account" }))).toMatchObject({
      kind: "risky_click",
      label: "Delete account",
    });
    expect(
      needsApproval(click, target({ label: "Go", isFormSubmit: true, formKind: "other" })),
    ).toMatchObject({ kind: "form_submit" });
    expect(
      needsApproval(click, target({ label: "Sign in", isFormSubmit: true, formKind: "login" })),
    ).toBeNull();
    expect(
      needsApproval(click, target({ label: "Search", isFormSubmit: true, formKind: "search" })),
    ).toBeNull();
    expect(needsApproval(click, target({ label: "Check" }))).toBeNull();
  });
  it("treats Enter, or a newline typed into an 'other' form, as a submit", () => {
    const field = target({ editable: true, formKind: "other", tag: "input" });
    expect(needsApproval({ type: "keypress", keys: ["ENTER"] }, field)).toMatchObject({
      kind: "form_submit",
    });
    expect(needsApproval({ type: "type", text: "hi\n" }, field)).toMatchObject({
      kind: "form_submit",
    });
    expect(needsApproval({ type: "type", text: "hi" }, field)).toBeNull();
    expect(
      needsApproval({ type: "keypress", keys: ["ENTER"] }, target({ formKind: "search" })),
    ).toBeNull();
  });
  it("applies risky labels to Enter and Space on the focused element", () => {
    const risky = target({ label: "Delete account" });
    expect(needsApproval({ type: "keypress", keys: ["ENTER"] }, risky)).toMatchObject({
      kind: "risky_click",
      label: "Delete account",
    });
    expect(needsApproval({ type: "keypress", keys: ["SPACE"] }, risky)).toMatchObject({
      kind: "risky_click",
    });
    expect(needsApproval({ type: "keypress", keys: ["enter"] }, risky)).not.toBeNull();
    expect(
      needsApproval({ type: "keypress", keys: ["SPACE"] }, target({ label: "Check" })),
    ).toBeNull();
    expect(needsApproval({ type: "keypress", keys: ["A"] }, risky)).toBeNull();
  });
  it("builds contract-valid approval requests", () => {
    const need = needsApproval(click, target({ label: "Pay now" }));
    expect(approvalRequestFor(need!, "https://a.com/x", null)).toEqual({
      kind: "risky_click",
      action: click,
      label: "Pay now",
      url: "https://a.com/x",
      screenshotKey: null,
    });
  });
});
