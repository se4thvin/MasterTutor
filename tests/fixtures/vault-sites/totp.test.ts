import { describe, expect, it } from "vitest";
import { codesEqual, totpAt, verifyTotp } from "./totp.ts";

describe("fixture TOTP (independent of otplib, so it cross-checks the agent)", () => {
  it("matches RFC 6238 SHA-1 vectors", () => {
    expect(totpAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59, 8)).toBe("94287082");
    expect(totpAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1111111109, 8)).toBe("07081804");
  });
  it("accepts one step of clock skew either way", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp("JBSWY3DPEHPK3PXP", totpAt("JBSWY3DPEHPK3PXP", now / 1000 - 30), now)).toBe(
      true,
    );
    expect(verifyTotp("JBSWY3DPEHPK3PXP", totpAt("JBSWY3DPEHPK3PXP", now / 1000 - 90), now)).toBe(
      false,
    );
  });
});

describe("one-time code comparison (constant time)", () => {
  it("compares codes without an early exit on the first differing digit", () => {
    expect(codesEqual("482913", "482913")).toBe(true);
    expect(codesEqual("482913", "482914")).toBe(false);
    expect(codesEqual("482913", "48291")).toBe(false);
    expect(codesEqual("", "")).toBe(false);
  });
  it("is the only way the fixture server checks a submitted code", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of ["server.ts", "totp.ts"]) {
      const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/===\s*(code|emailCode)\b|\b(code|emailCode)\s*===/);
    }
  });
});
