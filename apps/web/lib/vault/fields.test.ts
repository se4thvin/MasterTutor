import { describe, expect, it } from "vitest";
import {
  emptyVaultForm,
  isValidPin,
  normalizeTotpSeed,
  suggestAlias,
  toCreateInput,
} from "./fields.ts";

describe("vault field helpers", () => {
  it("normalises TOTP seeds from base32 or otpauth URIs", () => {
    expect(normalizeTotpSeed("jbsw y3dp ehpk 3pxp")).toBe("JBSWY3DPEHPK3PXP");
    expect(normalizeTotpSeed("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&issuer=x")).toBe(
      "JBSWY3DPEHPK3PXP",
    );
    expect(normalizeTotpSeed("not base32!")).toBeNull();
    expect(normalizeTotpSeed("ABC")).toBeNull();
  });
  it("accepts 4–12 digit PINs only", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("123")).toBe(false);
  });
  it("suggests an alias from the website", () => {
    expect(suggestAlias("https://learn.zybooks.com/signin")).toBe("zybooks");
    expect(suggestAlias("github.com")).toBe("github");
    expect(suggestAlias("")).toBe("");
  });
  it("builds the create input from enabled fields only", () => {
    const form = {
      ...emptyVaultForm(),
      label: "zyBooks",
      alias: "zybooks",
      origin: "learn.zybooks.com",
    };
    form.enabled.username = true;
    form.enabled.password = true;
    form.values.username = "me@example.test";
    form.values.password = "pw-canary";
    form.values.pin = "9999";
    const result = toCreateInput(form);
    expect(result.ok && result.input.secrets).toEqual({
      username: "me@example.test",
      password: "pw-canary",
    });
    expect(result.ok && result.input.origin).toBe("https://learn.zybooks.com");
  });
  it("reports field errors without echoing values", () => {
    const form = {
      ...emptyVaultForm(),
      label: "",
      alias: "Bad Alias",
      origin: "javascript:alert(1)",
    };
    form.enabled.pin = true;
    form.values.pin = "12x";
    const result = toCreateInput(form);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // emptyVaultForm enables username and password, which are empty here, so they error too.
      expect(Object.keys(result.errors).sort()).toEqual([
        "alias",
        "label",
        "origin",
        "password",
        "pin",
        "username",
      ]);
      expect(JSON.stringify(result.errors)).not.toContain("12x");
    }
  });
  it("rejects non-http(s) origins", () => {
    for (const origin of [
      "javascript:alert(1)",
      "ftp://example.com",
      "file:///etc/passwd",
      "data:text/html,x",
    ]) {
      const form = { ...emptyVaultForm(), label: "x", alias: "x", origin };
      form.enabled.username = false;
      form.enabled.password = false;
      const result = toCreateInput(form);
      expect(result.ok, origin).toBe(false);
      expect(!result.ok && result.errors.origin).toBeTruthy();
    }
  });
});
