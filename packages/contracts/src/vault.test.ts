import { describe, expect, it } from "vitest";
import { CREDENTIAL_ERROR_CODES, PASSKEY_ERROR_CODES } from "./tools.ts";
import { PinValue, parseTotpSeed, secretValueProblem } from "./vault.ts";

describe("parseTotpSeed (Review Focus 2: keys pasted in real-world shapes)", () => {
  it("accepts a bare base32 key in any case, grouped, hyphenated or padded", () => {
    const expected = { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30, algorithm: "sha1" };
    for (const input of [
      "JBSWY3DPEHPK3PXP",
      "jbsw y3dp ehpk 3pxp",
      "JBSW-Y3DP-EHPK-3PXP",
      "  jbswy3dpehpk3pxp====  ",
    ]) {
      expect(parseTotpSeed(input), input).toEqual(expected);
    }
  });

  it("reads otpauth:// links with their parameters", () => {
    expect(
      parseTotpSeed(
        "otpauth://totp/ACME:me%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=ACME&digits=8&period=60&algorithm=SHA256",
      ),
    ).toEqual({
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      digits: 8,
      period: 60,
      algorithm: "sha256",
    });
  });

  it("rejects what cannot produce a TOTP", () => {
    for (const input of [
      "",
      "JBSWY3DP",
      "JBSWY3DPEHPK3PX1",
      "otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1",
      "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=5",
      "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=5",
      "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5",
      "otpauth://totp/x",
    ]) {
      expect(parseTotpSeed(input), input).toBeNull();
    }
  });
});

describe("credential error codes", () => {
  it("lets the model tell a missing field apart from a failed fill", () => {
    expect(CREDENTIAL_ERROR_CODES).toContain("field_not_stored");
    expect(PASSKEY_ERROR_CODES).toContain("approval_required");
  });
});

describe("secret values at the trust boundary (E3, E4)", () => {
  it("accepts 4–12 digit PINs only", () => {
    expect(PinValue.safeParse("1234").success).toBe(true);
    expect(PinValue.safeParse("123456789012").success).toBe(true);
    for (const pin of ["123", "12a4", "1234567890123", " 1234"]) {
      expect(PinValue.safeParse(pin).success, pin).toBe(false);
    }
  });
  it("names the problem without echoing the value", () => {
    expect(secretValueProblem("pin", "12x")).not.toBeNull();
    expect(secretValueProblem("pin", "12x")).not.toContain("12x");
    expect(secretValueProblem("totp", "not-a-key")).not.toBeNull();
    expect(
      secretValueProblem("totp", "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=8"),
    ).toBeNull();
    expect(secretValueProblem("password", "anything at all")).toBeNull();
  });
});

describe("parseTotpSeed strictness (review 1, 12)", () => {
  it("rejects base32 lengths no encoder produces (len % 8 of 1, 3 or 6)", () => {
    for (const input of ["JBSWY3DPEHPK3PXPA", "JBSWY3DPEHPK3PXPABC", "JBSWY3DPEHPK3PXPABCDEF"]) {
      expect(parseTotpSeed(input), input).toBeNull();
    }
    for (const input of ["JBSWY3DPEHPK3PXPAB", "JBSWY3DPEHPK3PXPABCD", "JBSWY3DPEHPK3PXPABCDE"]) {
      expect(parseTotpSeed(input), input).not.toBeNull();
    }
  });
  it("reads digits and period only as plain decimal integers", () => {
    const link = (query: string) => `otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&${query}`;
    for (const query of ["digits=0x8", "digits=%208", "period=3e1", "period=0x1e", "period=30.0"]) {
      expect(parseTotpSeed(link(query)), query).toBeNull();
    }
    expect(parseTotpSeed(link("digits=8&period=60"))).toMatchObject({ digits: 8, period: 60 });
  });
});
