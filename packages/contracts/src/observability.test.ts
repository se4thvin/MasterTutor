import { describe, expect, it } from "vitest";
import { liveForwardAuthAddress } from "./live.ts";
import {
  OBSERVABILITY_AUTH_PATH,
  observabilityForwardAuthAddress,
  observabilityRouterRule,
} from "./observability.ts";

describe("/observability routing (spec §12)", () => {
  it("targets web's static cdp address like the live ForwardAuth", () => {
    expect(observabilityForwardAuthAddress()).toBe(
      `http://172.30.231.11:3000${OBSERVABILITY_AUTH_PATH}`,
    );
    expect(liveForwardAuthAddress("10.9.8")).toBe("http://10.9.8.11:3000/api/live/auth");
    expect(() => observabilityForwardAuthAddress("10.9")).toThrow();
  });

  it("matches /observability and its subtree only", () => {
    expect(observabilityRouterRule("mt.example.com")).toBe(
      "Host(`mt.example.com`) && PathRegexp(`^/observability(/|$)`)",
    );
    expect(() => observabilityRouterRule("bad host`")).toThrow();
  });
});
