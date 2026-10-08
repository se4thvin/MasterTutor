import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservabilityDecision } from "@/lib/server/observability/authorize.ts";

const state = vi.hoisted(() => ({ decision: null as unknown }));
vi.mock("@/lib/server/observability/viewer-decision.ts", () => ({
  viewerObservabilityDecision: async () => state.decision,
}));

const { GET } = await import("./route.ts");
const decide = (decision: ObservabilityDecision) => {
  state.decision = decision;
};

beforeEach(() => decide({ kind: "forbidden" }));

describe("GET /api/observability/auth (ForwardAuth, spec §12)", () => {
  it("gives Traefik the viewer's credentials and a cookie that replaces ours, never cached", async () => {
    decide({ kind: "allow", authorization: "Basic dmlld2VyOnB3" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("authorization")).toBe("Basic dmlld2VyOnB3");
    expect(response.headers.get("cookie")).toBe("mt_obs=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a member with 403 and no credentials (Review Focus 4)", async () => {
    const response = await GET();
    expect(response.status).toBe(403);
    expect(response.headers.get("authorization")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sends a signed-out visitor to sign in, and is 503 without a viewer password", async () => {
    decide({ kind: "sign_in", location: "/sign-in?next=%2Fapi%2Fobservability%2Fenter" });
    const signIn = await GET();
    expect([signIn.status, signIn.headers.get("location")]).toEqual([
      302,
      "/sign-in?next=%2Fapi%2Fobservability%2Fenter",
    ]);
    decide({ kind: "unavailable" });
    expect((await GET()).status).toBe(503);
  });
});
