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

const time = 1_000_000_000;
const instant = { start: time, end: time, step: 1 };
const day = 86400;
describe("whole-expression time and evaluation budgets", () => {
  it.each([
    "sum_over_time((mt_runs_ended)[365d:1s])",
    "rate(mt_runs_ended[91d])",
    "(mt_runs_ended offset 91d)[1h]",
    "(sum_over_time((mt_runs_ended)[365d:1s]))[1h]",
    "rate(mt_runs_ended[1y])",
    "rate(mt_runs_ended[9000000])",
    "sum_over_time((mt_runs_ended)[1h:1s])",
    "sum_over_time((mt_runs_ended)[1h:])",
    "sum_over_time((mt_runs_ended)[1h:0s])",
    "sum_over_time((mt_runs_ended)[1h:1ms])",
    "sum_over_time((mt_runs_ended)[1h:91d])",
    "max_over_time((max_over_time((mt_runs_ended)[20m:1m]))[20m:1m])",
    "max_over_time((rate(mt_runs_ended[50d]))[50d:1d])",
    "rate(mt_runs_ended[80d] offset 20d)",
    "mt_runs_ended offset 91d",
    "mt_runs_ended offset -91d",
    "mt_runs_ended offset 9e6",
    `mt_runs_ended @ ${time - 91 * day}`,
    `mt_runs_ended @ ${time + 91 * day}`,
    `mt_runs_ended offset 50d @ ${time - 50 * day}`,
    `mt_runs_ended @ ${time - 50 * day} offset 50d`,
    "sum_over_time((vector(1))[1h:1s])",
  ])("refuses %s", (query) => {
    expect(checkPromql(query, instant).ok).toBe(false);
  });
  it("includes the outer range, sibling expressions and implicit five-minute lookback", () => {
    expect(
      checkPromql("rate(mt_runs_ended[2d])", { start: time, end: time + 89 * day, step: day }).ok,
    ).toBe(false);
    expect(checkPromql("mt_runs_ended", { start: time, end: time + 90 * day, step: day }).ok).toBe(
      false,
    );
    expect(checkPromql("mt_runs_ended offset 90d", instant).ok).toBe(false);
    expect(
      checkPromql("sum_over_time((mt_runs_ended)[1s:1s])", {
        start: time,
        end: time + 89 * day,
        step: 89 * day,
      }).ok,
    ).toBe(false);
    expect(
      checkPromql("mt_runs_ended + mt_runs_ended", { start: time, end: time + 150, step: 1 }).ok,
    ).toBe(false);
    expect(
      checkPromql("sum_over_time((mt_runs_ended)[5m:1m])", { start: time, end: time + 50, step: 1 })
        .ok,
    ).toBe(false);
    expect(
      checkPromql("mt_runs_ended @ start()", { start: time, end: time + 90 * day, step: day }).ok,
    ).toBe(false);
  });
  it.each([
    "rate(mt_runs_ended[90d])",
    "sum_over_time((mt_runs_ended)[1h:1m])",
    "max_over_time((max_over_time((mt_runs_ended)[5m:1m]))[5m:1m])",
    "rate(mt_runs_ended[1h30m] offset 1d)",
    "mt_runs_ended offset -1h",
    `mt_runs_ended @ ${time}`,
    `mt_runs_ended @ ${time} offset 1h`,
    `mt_runs_ended offset 1h @ ${time}`,
    "mt_runs_ended @ start()",
    "mt_runs_ended @ end()",
    'mt_runs_ended{span_name="[365d:1s] offset 365d @ 0"}',
    "sum_over_time((vector(1))[5m:1m])",
  ])("accepts bounded %s", (query) => {
    expect(checkPromql(query, instant)).toEqual({ ok: true });
  });
});
