import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupFrom } from "@/lib/server/observability/access.ts";
import { verifyObservabilityToken } from "@/lib/server/observability/token.ts";

const setup = setupFrom({
  BETTER_AUTH_URL: "https://mt.example.com",
  BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
  CDP_SUBNET_PREFIX: "10.9.8",
  OBSERVE_VIEWER_PASSWORD: "Viewer-password-0123456789!",
} as never);
const state = vi.hoisted(() => ({ viewer: null as { id: string } | null, owner: true }));
vi.mock("@/lib/server/viewer.ts", () => ({ getViewer: async () => state.viewer }));
vi.mock("@/lib/server/observability/access.ts", async (original) => {
  const real = await original<object>();
  return { ...real, observabilitySetup: () => setup, isOwnerSignedIn: async () => state.owner };
});

const { GET } = await import("./route.ts");

beforeEach(() => {
  state.viewer = { id: "user_owner" };
  state.owner = true;
});

describe("GET /observability on the app host (D50 ruling I-2)", () => {
  it("hands the owner to obs.<app host> with a one-minute ticket, by POST", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const html = await response.text();
    expect(html).toContain('action="https://obs.mt.example.com/api/observability/session"');
    const ticket = /name="ticket" value="([^"]+)"/.exec(html)![1]!;
    const now = Math.floor(Date.now() / 1_000);
    expect(verifyObservabilityToken(setup.key, "ticket", ticket, now)).toBe("user_owner");
    expect(verifyObservabilityToken(setup.key, "ticket", ticket, now + 61)).toBeNull();
    expect(html).not.toContain("Viewer-password");
  });

  it("sends the signed-out to sign in and back, and refuses a member", async () => {
    state.viewer = null;
    const signIn = await GET();
    expect([signIn.status, signIn.headers.get("location")]).toEqual([
      302,
      "/sign-in?next=%2Fobservability",
    ]);
    state.viewer = { id: "user_member" };
    state.owner = false;
    expect((await GET()).status).toBe(403);
  });
});
