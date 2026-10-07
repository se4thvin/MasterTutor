import { beforeEach, describe, expect, it, vi } from "vitest";
import { signLiveSlot } from "@/lib/server/live/cookie.ts";

const secret = "live-cookie-secret-for-tests-0123456789";
const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const state = vi.hoisted(() => ({
  viewer: null as { id: string } | null | Error,
  logged: [] as unknown[],
}));

vi.mock("@/lib/server/viewer.ts", () => ({
  getViewer: async () => {
    if (state.viewer instanceof Error) throw state.viewer;
    return state.viewer;
  },
}));
vi.mock("@/lib/server/live/deps.ts", () => ({
  getAuthorizeDeps: () => ({ liveCookieSecret: secret, canAccess: async () => true }),
}));
vi.mock("@mastertutor/contracts/server", async (original) => ({
  ...(await original<object>()),
  createLogger: () => ({
    error: (fields: unknown) => void state.logged.push(fields),
    warn: () => undefined,
    info: () => undefined,
  }),
}));

const { GET } = await import("./route.ts");

const slot = (userId: string) =>
  `live_slot=${signLiveSlot(secret, { slotName: "browser-1", runId, userId, expiresAt: Math.floor(Date.now() / 1000) + 600 })}`;
const request = (cookies: string[]) =>
  new Request("http://web/api/live/auth", {
    headers: { "x-forwarded-uri": `/live/${runId}/api/ws`, cookie: cookies.join("; ") },
  });

beforeEach(() => {
  state.viewer = { id: "user_a" };
  state.logged = [];
});

describe("GET /api/live/auth (ForwardAuth route)", () => {
  it("answers 200 with only NEKO_SESSION as the upstream cookie, never cached", async () => {
    const response = await GET(
      request(["better-auth.session_token=s3cr3t", slot("user_a"), "NEKO_SESSION=tok123"]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cookie")).toBe("NEKO_SESSION=tok123");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a refusal with no cookie and no-store", async () => {
    const response = await GET(request([slot("user_a")]));
    expect(response.status).toBe(401);
    expect(response.headers.get("cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed when the session lookup throws, and logs the error type only (M6)", async () => {
    state.viewer = new TypeError("database said: password=hunter2");
    const response = await GET(request([slot("user_a"), "NEKO_SESSION=tok123"]));
    expect(response.status).toBe(401);
    expect(state.logged).toEqual([
      expect.objectContaining({ errorCode: "live_auth_session_failed", err: "TypeError" }),
    ]);
    expect(JSON.stringify(state.logged)).not.toContain("hunter2");
  });
});
