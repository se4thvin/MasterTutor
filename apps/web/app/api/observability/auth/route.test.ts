import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupFrom } from "@/lib/server/observability/access.ts";
import { signObservabilityToken } from "@/lib/server/observability/token.ts";

const PASSWORD = "Viewer-password-0123456789!";
const setup = setupFrom({
  BETTER_AUTH_URL: "https://mt.example.com",
  BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
  CDP_SUBNET_PREFIX: "10.9.8",
  OBSERVE_VIEWER_PASSWORD: PASSWORD,
} as never);
const state = vi.hoisted(() => ({ owner: true, password: "x" as string | undefined }));
vi.mock("@/lib/server/observability/access.ts", async (original) => {
  const real = await original<object>();
  return {
    ...real,
    observabilitySetup: () => ({ ...setup, viewerPassword: state.password }),
    isOwnerSignedIn: async () => state.owner,
  };
});

const { GET } = await import("./route.ts");
const now = Math.floor(Date.now() / 1_000);
const session = (purpose: "session" | "ticket" = "session") =>
  signObservabilityToken(setup.key, { purpose, userId: "user_owner", expiresAt: now + 600 });
const forwardAuth = (headers: Record<string, string> = {}) =>
  new Request("http://10.9.8.11:3000/api/observability/auth", {
    headers: { host: "10.9.8.11:3000", ...headers },
  });

beforeEach(() => {
  state.owner = true;
  state.password = PASSWORD;
});

describe("GET /api/observability/auth (Traefik ForwardAuth, spec §12)", () => {
  it("gives Traefik the viewer's credentials and a cookie that replaces the browser's", async () => {
    const response = await GET(forwardAuth({ cookie: `a=1; mt_obs_session=${session()}` }));
    expect(response.status).toBe(200);
    expect(response.headers.get("authorization")).toBe(
      `Basic ${Buffer.from(`viewer@mastertutor.internal:${PASSWORD}`).toString("base64")}`,
    );
    expect(response.headers.get("cookie")).toBe("mt_obs=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not exist for a public or obs-host request, even the owner's (review I-1)", async () => {
    for (const host of ["mt.example.com", "obs.mt.example.com", "172.30.231.11:3000"]) {
      const response = await GET(forwardAuth({ host, cookie: `mt_obs_session=${session()}` }));
      expect(response.status, host).toBe(404);
      expect(response.headers.get("authorization"), host).toBeNull();
    }
  });

  it("sends a browser without an obs session back to the app's way in", async () => {
    for (const cookie of ["", `mt_obs_session=${session("ticket")}`, "mt_obs_session=forged"]) {
      const response = await GET(forwardAuth({ cookie }));
      expect([response.status, response.headers.get("location")]).toEqual([
        302,
        "https://mt.example.com/observability",
      ]);
    }
  });

  it("is 403 once the owner signed out or lost the role, and 503 without a viewer password", async () => {
    state.owner = false;
    expect((await GET(forwardAuth({ cookie: `mt_obs_session=${session()}` }))).status).toBe(403);
    state.owner = true;
    state.password = undefined;
    expect((await GET(forwardAuth({ cookie: `mt_obs_session=${session()}` }))).status).toBe(503);
  });
});
