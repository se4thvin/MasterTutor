import { describe, expect, it } from "vitest";
import type { TargetInfo } from "./dom.ts";
import { fieldAccepts } from "./field-rules.ts";

const input = (over: Partial<TargetInfo>): TargetInfo => ({
  tag: "input",
  type: "text",
  autocomplete: [],
  inputMode: "",
  hints: "",
  hasPasswordInScope: false,
  visible: true,
  editable: true,
  maxLength: -1,
  origin: "https://a.example",
  formOrigins: [],
  ...over,
});

describe("fieldAccepts (spec §9 field-type check)", () => {
  it("password needs a password input, or a revealed one marked as a password", () => {
    expect(fieldAccepts("password", input({ type: "password" }))).toBe(true);
    expect(
      fieldAccepts("password", input({ type: "text", autocomplete: ["current-password"] })),
    ).toBe(true);
    expect(fieldAccepts("password", input({ type: "text", hints: "password" }))).toBe(false);
    expect(fieldAccepts("password", input({ type: "email" }))).toBe(false);
  });

  it("username needs an email/username field or a text field in a login form", () => {
    expect(fieldAccepts("username", input({ type: "email" }))).toBe(true);
    expect(fieldAccepts("username", input({ autocomplete: ["section-a", "username"] }))).toBe(true);
    expect(fieldAccepts("username", input({ hasPasswordInScope: true }))).toBe(true);
    expect(fieldAccepts("username", input({ hints: "user id" }))).toBe(true);
    expect(fieldAccepts("username", input({ hints: "comments" }))).toBe(false);
    expect(fieldAccepts("username", input({ type: "password", autocomplete: ["username"] }))).toBe(
      false,
    );
  });

  it("totp and otp need one-time-code, a numeric input or an OTP-labelled field", () => {
    for (const field of ["totp", "otp"] as const) {
      expect(fieldAccepts(field, input({ autocomplete: ["one-time-code"] }))).toBe(true);
      expect(fieldAccepts(field, input({ inputMode: "numeric" }))).toBe(true);
      expect(fieldAccepts(field, input({ type: "tel" }))).toBe(true);
      expect(fieldAccepts(field, input({ hints: "verification code" }))).toBe(true);
      expect(fieldAccepts(field, input({ hints: "search" }))).toBe(false);
    }
  });

  it("pin needs a password or numeric input", () => {
    expect(fieldAccepts("pin", input({ type: "password" }))).toBe(true);
    expect(fieldAccepts("pin", input({ inputMode: "numeric" }))).toBe(true);
    expect(fieldAccepts("pin", input({ type: "text" }))).toBe(false);
  });

  it("never fills hidden, disabled or non-input elements", () => {
    expect(fieldAccepts("password", input({ type: "password", visible: false }))).toBe(false);
    expect(fieldAccepts("password", input({ type: "password", editable: false }))).toBe(false);
    expect(fieldAccepts("username", input({ tag: "textarea", type: "" }))).toBe(false);
  });
});
