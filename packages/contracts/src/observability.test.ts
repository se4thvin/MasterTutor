import { describe, expect, it } from "vitest";
import { liveForwardAuthAddress } from "./live.ts";
import {
  ALERT_WEBHOOK_INTERNAL_URL,
  OBSERVABILITY_AUTH_PATH,
  observabilityForwardAuthAddress,
  observabilityForwardAuthHost,
  observabilityOrigin,
  internalWebHosts,
  observabilityRouterRule,
  observabilitySessionRouterRule,
} from "./observability.ts";

describe("/observability routing (spec §12, D50 ruling I-2)", () => {
  it("targets web's static cdp address like the live ForwardAuth", () => {
    expect(observabilityForwardAuthAddress()).toBe(
      `http://172.30.231.11:3000${OBSERVABILITY_AUTH_PATH}`,
    );
    expect(observabilityForwardAuthHost("10.9.8")).toBe("10.9.8.11:3000");
    expect(liveForwardAuthAddress("10.9.8")).toBe("http://10.9.8.11:3000/api/live/auth");
    expect(() => observabilityForwardAuthAddress("10.9")).toThrow();
  });

  it("serves OpenObserve on its own host, obs.<app host>", () => {
    expect(observabilityOrigin("https://mt.example.com/x")).toBe("https://obs.mt.example.com");
    expect(observabilityOrigin("http://localhost:18080")).toBe("http://obs.localhost:18080");
    expect(observabilityRouterRule("mt.example.com")).toBe("Host(`obs.mt.example.com`)");
    expect(observabilitySessionRouterRule("mt.example.com")).toBe(
      "Host(`obs.mt.example.com`) && Path(`/api/observability/session`)",
    );
    expect(() => observabilityRouterRule("bad host`")).toThrow();
  });

  it("has OpenObserve post alerts to web's internal authority", () => {
    expect(ALERT_WEBHOOK_INTERNAL_URL).toBe("http://web:3000/api/alerts/webhook");
  });

  it("allows exactly the two internal Hosts, from config", () => {
    expect(internalWebHosts()).toEqual(["web:3000", "172.30.231.11:3000"]);
    expect(internalWebHosts("10.9.8")).toEqual(["web:3000", "10.9.8.11:3000"]);
  });
});
