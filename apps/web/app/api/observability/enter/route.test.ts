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

describe("GET /api/observability/enter (spec §12)", () => {
  it("gives the owner the entry page, never cached, without the viewer's credentials", async () => {
    decide({ kind: "allow", authorization: "Basic dmlld2VyOnB3" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("authorization")).toBeNull();
    const html = await response.text();
    expect(html).toContain('location.replace("/observability/web/")');
    expect(html).not.toContain("dmlld2VyOnB3");
  });

  it("is 403 for a member, 503 without a viewer password, and sends the signed-out to sign in", async () => {
    expect((await GET()).status).toBe(403);
    decide({ kind: "unavailable" });
    expect((await GET()).status).toBe(503);
    decide({ kind: "sign_in", location: "/sign-in?next=%2Fapi%2Fobservability%2Fenter" });
    const signIn = await GET();
    expect([signIn.status, signIn.headers.get("location")]).toEqual([
      302,
      "/sign-in?next=%2Fapi%2Fobservability%2Fenter",
    ]);
  });
});
