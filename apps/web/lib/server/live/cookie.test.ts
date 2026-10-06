import { describe, expect, it } from "vitest";
import { liveSetCookies, parseCookies, signLiveSlot, verifyLiveSlot } from "./cookie.ts";

const secret = "live-cookie-secret-for-tests-0123456789";
const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const claim = { slotName: "browser-3", runId, userId: "user_a", expiresAt: 1_700_000_600 };

describe("live_slot signing", () => {
  it("round-trips and exposes the slot prefix Traefik routes on", () => {
    const value = signLiveSlot(secret, claim);
    expect(value).toMatch(/^browser-3\.1700000600\.[A-Za-z0-9_-]{43}$/);
    expect(
      verifyLiveSlot(secret, value, { runId, userId: "user_a", nowSeconds: 1_700_000_000 }),
    ).toBe("browser-3");
  });
  it("rejects other runs, other users, expiry, tampering and other secrets", () => {
    const value = signLiveSlot(secret, claim);
    const ok = { runId, userId: "user_a", nowSeconds: 1_700_000_000 };
    expect(
      verifyLiveSlot(secret, value, { ...ok, runId: "11111111-1111-4111-8111-111111111111" }),
    ).toBeNull();
    expect(verifyLiveSlot(secret, value, { ...ok, userId: "user_b" })).toBeNull();
    expect(verifyLiveSlot(secret, value, { ...ok, nowSeconds: 1_700_000_600 })).toBeNull();
    expect(verifyLiveSlot(secret, value.replace("browser-3", "browser-4"), ok)).toBeNull();
    expect(verifyLiveSlot(`${secret}x`, value, ok)).toBeNull();
    expect(verifyLiveSlot(secret, "browser-3.notanumber.x", ok)).toBeNull();
  });
});

describe("cookies", () => {
  it("parses repeated cookies in order", () => {
    const cookies = parseCookies("a=1; live_slot=x; b=2;live_slot=y");
    expect(cookies.get("live_slot")).toEqual(["x", "y"]);
    expect(cookies.get("a")).toEqual(["1"]);
    expect(parseCookies(null).size).toBe(0);
  });
  it("scopes Set-Cookie to the run's live path with strict attributes", () => {
    expect(liveSetCookies(runId, [{ name: "NEKO_SESSION", value: "tok" }], 60)).toEqual([
      `NEKO_SESSION=tok; Path=/live/${runId}/; Max-Age=60; HttpOnly; Secure; SameSite=Strict`,
    ]);
    expect(() => liveSetCookies(runId, [{ name: "NEKO_SESSION", value: "a;b" }], 60)).toThrow();
  });
});
