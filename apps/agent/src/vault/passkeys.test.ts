import { describe, expect, it } from "vitest";
import { rpIdMatchesOrigin } from "./passkeys.ts";

describe("rpIdMatchesOrigin (passkey RP ID must belong to the pinned origin)", () => {
  it("accepts the host itself and registrable parents", () => {
    expect(rpIdMatchesOrigin("learn.zybooks.com", "https://learn.zybooks.com")).toBe(true);
    expect(rpIdMatchesOrigin("zybooks.com", "https://learn.zybooks.com")).toBe(true);
  });
  it("rejects other sites, suffix tricks and bare TLDs", () => {
    expect(rpIdMatchesOrigin("evil.com", "https://learn.zybooks.com")).toBe(false);
    expect(rpIdMatchesOrigin("ks.com", "https://learn.zybooks.com")).toBe(false);
    expect(rpIdMatchesOrigin("com", "https://learn.zybooks.com")).toBe(false);
    expect(rpIdMatchesOrigin("learn.zybooks.com.evil.com", "https://learn.zybooks.com")).toBe(
      false,
    );
  });
});
