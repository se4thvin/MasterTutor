import { describe, expect, it } from "vitest";
import { checkPromql } from "./promql.ts";

describe("PromQL validation against the registry (spec §7.4)", () => {
  it("accepts registry metrics, spanmetrics and their histogram parts with registry labels", () => {
    for (const query of [
      "sum by (mt_run_status) (increase(mt_runs_ended[1h]))",
      'sum(increase(mt_span_calls{span_name="mt.step", mt_step_phase="act"}[5m]))',
      "histogram_quantile(0.95, sum by (le) (rate(mt_span_duration_bucket[5m])))",
      "sum by (mt_spend_purpose) (increase(mt_spend_usd[24h]))",
    ])
      expect(checkPromql(query), query).toEqual({ ok: true });
  });
  it("rejects an invented metric and lists valid names", () => {
    const result = checkPromql("sum(rate(mt_runs_total[5m]))");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("mt_runs_ended");
  });
  it("rejects an unknown label, __name__ matching and a syntax error", () => {
    expect(checkPromql('mt_runs_ended{user_email="x"}').ok).toBe(false);
    expect(checkPromql('{__name__=~".+"}').ok).toBe(false);
    expect(checkPromql("sum(").ok).toBe(false);
  });
});

it("refuses unnamed selectors and invented grouping labels", () => {
  expect(checkPromql('{mt_run_status="failed"}').ok).toBe(false);
  expect(checkPromql("sum by (invented) (mt_runs_ended)").ok).toBe(false);
});
