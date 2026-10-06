import { describe, expect, it } from "vitest";
import {
  LIVE_STRIP_REGEX,
  OpenLiveResult,
  liveEmbedPath,
  liveForwardAuthAddress,
  livePath,
  liveRouterRule,
  liveSlotCookiePattern,
  runIdFromLivePath,
} from "./live.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("live view contracts", () => {
  it("builds per-run paths with the legacy client's auto-connect placeholders", () => {
    expect(livePath(runId)).toBe(`/live/${runId}/`);
    expect(liveEmbedPath(runId)).toBe(`/live/${runId}/?embed=1&usr=user&pwd=cookie`);
    expect(() => livePath("../etc")).toThrow();
  });

  it("parses both openLive shapes and rejects other embed paths", () => {
    expect(OpenLiveResult.parse({ sleeping: true })).toEqual({ sleeping: true });
    const awake = OpenLiveResult.parse({
      sleeping: false,
      slotName: "browser-3",
      embedPath: liveEmbedPath(runId),
      iceServers: [],
    });
    expect(awake.sleeping).toBe(false);
    for (const embedPath of [
      "/admin",
      `/live/${runId}/?embed=1`,
      `/live/${runId}/?embed=1&usr=user&pwd=x`,
    ]) {
      expect(
        OpenLiveResult.safeParse({
          sleeping: false,
          slotName: "browser-1",
          embedPath,
          iceServers: [],
        }).success,
        embedPath,
      ).toBe(false);
    }
  });

  it("extracts the run id from a forwarded URI", () => {
    expect(runIdFromLivePath(`/live/${runId}/`)).toBe(runId);
    expect(runIdFromLivePath(`/live/${runId}/api/ws?x=1`)).toBe(runId);
    expect(runIdFromLivePath(`/live/${runId}`)).toBeNull();
    expect(runIdFromLivePath("/live/zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/")).toBeNull();
    expect(runIdFromLivePath("/api/auth/session")).toBeNull();
  });

  it("matches only an exact live_slot cookie for the given slot", () => {
    const pattern = new RegExp(liveSlotCookiePattern("browser-1"));
    expect(pattern.test("live_slot=browser-1.1700000000.sig")).toBe(true);
    expect(pattern.test("a=1; live_slot=browser-1.1700000000.sig")).toBe(true);
    expect(pattern.test("a=1;live_slot=browser-1.1.s")).toBe(true);
    expect(pattern.test("live_slot=browser-10.1700000000.sig")).toBe(false);
    expect(pattern.test("xlive_slot=browser-1.1700000000.sig")).toBe(false);
    expect(() => liveSlotCookiePattern("postgres")).toThrow();
  });

  it("renders the one Traefik rule used by the test routers and Phase 9's labels", () => {
    expect(liveRouterRule("browser-2", "notes.example.com")).toBe(
      "Host(`notes.example.com`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\\s*)live_slot=browser-2\\.`)",
    );
    expect(LIVE_STRIP_REGEX).toBe("^/live/[0-9a-f-]{36}");
    expect(() => liveRouterRule("browser-1", "bad host`")).toThrow();
  });

  it("points ForwardAuth at web's static cdp address, never the ambiguous `web` name (D41)", () => {
    expect(liveForwardAuthAddress()).toBe("http://172.30.231.11:3000/api/live/auth");
    expect(liveForwardAuthAddress("10.42.7")).toBe("http://10.42.7.11:3000/api/live/auth");
    for (const bad of ["web", "1.2.3.4", "1.2", "a.b.c", "300.1.1"]) {
      expect(() => liveForwardAuthAddress(bad), bad).toThrow();
    }
  });
});
