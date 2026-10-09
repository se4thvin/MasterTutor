import { describe, expect, it } from "vitest";
import { vapidKeyPair, vapidPairMatches } from "./vapid.ts";

describe("VAPID keys (spec §13.4)", () => {
  it("generates a base64url P-256 pair in the env shape", () => {
    const pair = vapidKeyPair();
    expect(pair.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(pair.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(vapidPairMatches(pair.publicKey, pair.privateKey)).toBe(true);
    expect(vapidPairMatches(vapidKeyPair().publicKey, pair.privateKey)).toBe(false);
    expect(vapidPairMatches(pair.publicKey, "not-a-key")).toBe(false);
  });
});
