import { ALERT_RULES } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";

interface O2AlertBody {
  name: string;
  destinations: string[];
  stream_type: string;
  stream_name: string;
  trigger_condition: Record<string, unknown>;
  query_condition: { sql: string | null; promql_condition: Record<string, unknown> | null };
}
import { alertSpecs, toO2Alert } from "./alerts.ts";
import { ALERT_DESTINATION_NAME } from "./provision.ts";

describe("alerts as code (spec §13.1)", () => {
  const specs = alertSpecs({ spendUsdPerHour: 25 });

  it("defines exactly the contract's rules", () => {
    expect(Object.keys(specs).sort()).toEqual([...ALERT_RULES].sort());
  });

  it("uses the registered streams and thresholds", () => {
    expect(specs.run_failed.query).toMatchObject({
      type: "promql",
      stream: "mt_runs_ended",
      expr: 'sum (increase(mt_runs_ended{mt_run_status="failed"}[5m]))',
    });
    expect(specs.model_request_rejected.query).toMatchObject({
      expr: expect.stringContaining('mt_error_code="model_request_rejected"'),
    });
    expect(specs.slot_crash_loop.query).toMatchObject({
      expr: expect.stringContaining("[10m]"),
    });
    expect(specs.spend_jump.threshold).toBe(25);
    expect(specs.slot_crash_loop.threshold).toBe(3);
    expect(specs.error_spike).toMatchObject({ threshold: 20, periodMinutes: 5 });
  });

  it("names the alert after the rule and delivers to web with a 30 min silence", () => {
    const body = toO2Alert("run_failed", specs.run_failed) as unknown as O2AlertBody;
    expect(body.name).toBe("run_failed");
    expect(body.destinations).toEqual([ALERT_DESTINATION_NAME]);
    expect(body.trigger_condition).toMatchObject({ silence: 30, period: 5, threshold: 1 });
    expect(body.query_condition.promql_condition).toMatchObject({ operator: ">=", value: 1 });
  });

  it("puts a SQL rule's count in HAVING, because OpenObserve's threshold counts rows (B1)", () => {
    const body = toO2Alert("error_spike", specs.error_spike) as unknown as O2AlertBody;
    expect(body.query_condition.sql).toMatch(
      /WHERE severity IN \('ERROR', 'FATAL'\) HAVING count\(\*\) >= 20$/,
    );
    expect(body.trigger_condition).toMatchObject({ threshold: 1, period: 5 });
    expect(body).toMatchObject({ stream_type: "logs", stream_name: "mastertutor" });
  });
});
