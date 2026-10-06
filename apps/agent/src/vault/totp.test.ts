import { describe, expect, it } from "vitest";
import { TOTP_MIN_REMAINING_MS, msUntilFreshWindow, totpCode, totpStep } from "./totp.ts";

describe("TOTP generation", () => {
  it("matches RFC 6238 and accepts 80-bit keys (planning verification 7)", () => {
    expect(
      totpCode("otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8", 59_000),
    ).toBe("94287082");
    expect(totpCode("jbsw y3dp ehpk 3pxp", 59_000)).toBe("996554");
    expect(totpCode("not a key", 59_000)).toBeNull();
  });

  it("waits for a fresh window when the current code has under 3 seconds left (Review Focus 2)", () => {
    expect(msUntilFreshWindow("JBSWY3DPEHPK3PXP", 28_500)).toBe(1_550);
    expect(msUntilFreshWindow("JBSWY3DPEHPK3PXP", 30_000 - TOTP_MIN_REMAINING_MS)).toBe(0);
    expect(msUntilFreshWindow("JBSWY3DPEHPK3PXP", 10_000)).toBe(0);
    expect(msUntilFreshWindow("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=60", 59_000)).toBe(
      1_050,
    );
    expect(msUntilFreshWindow("bad", 0)).toBeNull();
  });
});

describe("TOTP algorithms and reuse (review minors)", () => {
  // RFC 6238 Appendix B: the seeds are the ASCII key repeated to the hash's size.
  const sha256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
  const sha512 =
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";
  it("keeps the otpauth algorithm: SHA-256 and SHA-512 RFC vectors", () => {
    const link = (secret: string, algorithm: string) =>
      `otpauth://totp/x?secret=${secret}&digits=8&algorithm=${algorithm}`;
    expect(totpCode(link(sha256, "SHA256"), 59_000)).toBe("46119246");
    expect(totpCode(link(sha256, "SHA256"), 1_111_111_109_000)).toBe("68084774");
    expect(totpCode(link(sha512, "SHA512"), 59_000)).toBe("90693936");
    expect(totpCode(link(sha512, "SHA512"), 1_111_111_109_000)).toBe("25091201");
  });

  it("generates for every key length the vault accepts (up to 128 base32 characters)", () => {
    expect(totpCode("A".repeat(128), 59_000)).toMatch(/^\d{6}$/);
  });

  it("waits for the next time step rather than typing the code it already typed", () => {
    expect(totpStep("JBSWY3DPEHPK3PXP", 10_000)).toBe(0);
    expect(msUntilFreshWindow("JBSWY3DPEHPK3PXP", 10_000, 0)).toBe(20_050);
    expect(msUntilFreshWindow("JBSWY3DPEHPK3PXP", 40_000, 0)).toBe(0);
  });
});
