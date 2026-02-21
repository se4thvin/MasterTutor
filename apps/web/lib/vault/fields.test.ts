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
  it("bounds TOTP seed length (a SHA-512 key is 103 base32 characters)", () => {
    expect(normalizeTotpSeed("A".repeat(128))).toBe("A".repeat(128));
    expect(normalizeTotpSeed("A".repeat(129))).toBeNull();
    expect(normalizeTotpSeed("A".repeat(100_000))).toBeNull();
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
  it("does not suggest a fragment of an IP address", () => {
    expect(suggestAlias("192.168.1.10")).toBe("");
    expect(suggestAlias("http://10.0.0.2:8080/login")).toBe("");
    expect(suggestAlias("http://[::1]:3000")).toBe("");
    expect(suggestAlias("http://localhost:3000")).toBe("localhost");
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
  it("reports a contract failure on the field that failed, without echoing values", () => {
    const form = { ...emptyVaultForm(), label: "x".repeat(121), alias: "x", origin: "x.test" };
    form.values.username = "me";
    form.values.password = "p".repeat(4_097);
    const result = toCreateInput(form);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["label", "password"]);
      expect(JSON.stringify(result.errors)).not.toContain("ppp");
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
