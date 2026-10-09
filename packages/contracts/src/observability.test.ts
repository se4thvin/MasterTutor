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
  observabilityUiPaths,
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

describe("OpenObserve UI deep links (Observer spike §10)", () => {
  it("carries the filter as base64 and the window in microseconds, under the UI path", () => {
    const path = observabilityUiPaths.traceList("default", {
      filter: "mt_run_id = 'r'",
      from: 1,
      to: 2,
    });
    const url = new URL(path, "https://obs.example.com");
    expect(url.pathname).toBe("/observability/web/traces");
    expect(atob(url.searchParams.get("query")!)).toBe("mt_run_id = 'r'");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      stream: "default",
      from: "1",
      to: "2",
      org_identifier: "default",
    });
    expect(observabilityUiPaths.traceDetail("default", { traceId: "ab", from: 1, to: 2 })).toBe(
      "/observability/web/traces/trace-details?stream=default&trace_id=ab&from=1&to=2&org_identifier=default",
    );
  });
});
