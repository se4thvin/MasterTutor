import { describe, expect, it } from "vitest";
import { isSecretField } from "./page-helpers.ts";

/** Page helpers only read a handful of properties, so a stand-in element is enough for node. */
function field(attrs: Record<string, string>, props: { name?: string; id?: string } = {}): Element {
  const input = {
    tagName: "INPUT",
    name: props.name ?? "",
    id: props.id ?? "",
    placeholder: attrs.placeholder ?? "",
    maxLength: attrs.maxlength ? Number(attrs.maxlength) : -1,
    getAttribute: (key: string) => attrs[key] ?? null,
  };
  return input as unknown as Element;
}
const named = (name: string) => field({ type: "text" }, { name });

describe("isSecretField hints", () => {
  it.each([
    "password",
    "userPassword",
    "passwordConfirm",
    "new_pwd",
    "confirm-passwd",
    "loginPasscode",
    "userPIN",
    "pin",
    "otpCode",
    "oneTimeCode",
    "verificationCode",
    "securityCode",
    "mfa_token",
    "user2fa",
  ])("treats %s as secret", (name) => expect(isSecretField(named(name))).toBe(true));

  it.each(["username", "email", "spinner", "option", "shipping", "fullname", "hotpot", "q"])(
    "does not treat %s as secret",
    (name) => expect(isSecretField(named(name))).toBe(false),
  );

  it("matches by id, aria-label and placeholder too", () => {
    expect(isSecretField(field({ type: "text" }, { id: "accountPassword" }))).toBe(true);
    expect(isSecretField(field({ type: "text", "aria-label": "Your PIN" }))).toBe(true);
    expect(isSecretField(field({ type: "text", placeholder: "Enter passcode" }))).toBe(true);
  });
});
