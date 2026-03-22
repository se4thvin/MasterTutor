import { describe, expect, it } from "vitest";
import { OTP_LOOKBACK_MS, forgetSpentMessages } from "./otp.ts";

describe("forgetSpentMessages (N3)", () => {
  it("drops used messages no inbox search can return any more, and keeps the rest", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    const used = new Map([
      ["old", now - OTP_LOOKBACK_MS - 61_000],
      ["recent", now - OTP_LOOKBACK_MS + 1_000],
    ]);
    forgetSpentMessages(used, now);
    expect([...used.keys()]).toEqual(["recent"]);
  });
});
