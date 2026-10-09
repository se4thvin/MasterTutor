import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupFrom } from "@/lib/server/observability/access.ts";
import {
  signObservabilityToken,
  verifyObservabilityToken,
} from "@/lib/server/observability/token.ts";

const setup = setupFrom({
  BETTER_AUTH_URL: "https://mt.example.com",
  BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
  CDP_SUBNET_PREFIX: "10.9.8",
  OBSERVE_VIEWER_PASSWORD: "Viewer-password-0123456789!",
} as never);
const state = vi.hoisted(() => ({ owner: true }));
vi.mock("@/lib/server/observability/access.ts", async (original) => {
  const real = await original<object>();
  return { ...real, observabilitySetup: () => setup, isOwnerSignedIn: async () => state.owner };
});

const { POST } = await import("./route.ts");
const now = Math.floor(Date.now() / 1_000);
const ticket = (purpose: "ticket" | "session" = "ticket", ttl = 60) =>
  signObservabilityToken(setup.key, { purpose, userId: "user_owner", expiresAt: now + ttl });
const post = (body: string, host = "obs.mt.example.com") =>
  new Request(`https://${host}/api/observability/session`, {
    method: "POST",
    headers: { host, "content-type": "application/x-www-form-urlencoded" },
    body,
  });

beforeEach(() => {
  state.owner = true;
});

describe("POST /api/observability/session (obs host, D50 ruling I-2)", () => {
  it("trades a ticket for a host-only obs session and seeds OpenObserve's UI", async () => {
    const response = await POST(post(`ticket=${ticket()}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(
      /^mt_obs_session=[^;]+; Path=\/; Max-Age=43200; HttpOnly; SameSite=Strict; Secure$/,
    );
    const token = /^mt_obs_session=([^;]+)/.exec(cookie)![1]!;
    expect(verifyObservabilityToken(setup.key, "session", token, now)).toBe("user_owner");
    expect(await response.text()).toContain('location.replace("/observability/web/")');
  });

  it("exists only on the obs host", async () => {
    for (const host of ["mt.example.com", "web:3000", "10.9.8.11:3000"])
      expect((await POST(post(`ticket=${ticket()}`, host))).status, host).toBe(404);
  });

  it("sends a bad, expired or reused-as-session ticket back to the app's way in", async () => {
    for (const body of [
      "",
      "ticket=forged",
      `ticket=${ticket("session")}`,
      `ticket=${ticket("ticket", -1)}`,
    ]) {
      const response = await POST(post(body));
      expect([response.status, response.headers.get("location")], body).toEqual([
        302,
        "https://mt.example.com/observability",
      ]);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("is 403 for someone who is no longer the signed-in owner, and refuses a big body", async () => {
    state.owner = false;
    expect((await POST(post(`ticket=${ticket()}`))).status).toBe(403);
    state.owner = true;
    expect((await POST(post(`ticket=${"a".repeat(5_000)}`))).status).toBe(413);
  });
});
