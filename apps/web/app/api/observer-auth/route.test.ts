import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  viewer: { id: "user_owner" } as { id: string } | null,
  membership: { role: "owner", workspaceId: "6f2c8a3e-0000-4000-8000-00000000000a" } as {
    role: string;
    workspaceId: string;
  } | null,
  owner: true,
  token: "test-token-0123456789" as string | undefined,
  lookupFailure: false,
}));
vi.mock("@/lib/server/viewer.ts", () => ({ getViewer: async () => state.viewer }));
vi.mock("@mastertutor/db", () => ({ memberRoleOf: async () => state.membership }));
vi.mock("@/lib/server/db.ts", () => ({ getDb: () => ({ db: {} }) }));
vi.mock("@/lib/server/env.ts", () => ({
  getWebEnv: () => ({ CDP_SUBNET_PREFIX: "10.9.8", OBSERVER_INTERNAL_TOKEN: state.token }),
}));
vi.mock("@/lib/server/observability/access.ts", () => ({
  isOwnerSignedIn: async () => {
    if (state.lookupFailure) throw new Error("private lookup failure");
    return state.owner;
  },
}));
const { GET } = await import("./route.ts");
const request = (host = "10.9.8.11:3000") =>
  new Request("http://10.9.8.11:3000/api/observer-auth", { headers: { host } });
beforeEach(() => {
  state.viewer = { id: "user_owner" };
  state.membership = { role: "owner", workspaceId: "6f2c8a3e-0000-4000-8000-00000000000a" };
  state.owner = true;
  state.lookupFailure = false;
  state.token = "test-token-0123456789";
});
describe("observer ForwardAuth", () => {
  it("is absent on public hosts and the wrong subnet", async () => {
    for (const host of ["mt.example.com", "obs.mt.example.com", "172.30.231.11:3000"])
      expect((await GET(request(host))).status).toBe(404);
  });
  it("replaces browser credentials with bounded service credentials and identity", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      authorization: `Bearer ${state.token}`,
      cookie: "mt_observer=1",
      "x-mt-user": "user_owner",
      "x-mt-workspace": state.membership!.workspaceId,
      "cache-control": "no-store",
    });
  });
  it("refuses signed out users, members and a missing service token", async () => {
    state.viewer = null;
    expect((await GET(request())).status).toBe(401);
    state.viewer = { id: "user_member" };
    state.membership!.role = "member";
    expect((await GET(request())).status).toBe(403);
    state.membership!.role = "owner";
    state.token = undefined;
    expect((await GET(request())).status).toBe(503);
  });
  it("fails closed when live ownership is lost or its lookup fails", async () => {
    state.owner = false;
    expect((await GET(request())).status).toBe(403);
    state.owner = true;
    state.lookupFailure = true;
    expect((await GET(request())).status).toBe(403);
  });
});
