import { describe, expect, it } from "vitest";
import { TOTP_MIN_REMAINING_MS, msUntilFreshWindow, totpCode } from "./totp.ts";

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
