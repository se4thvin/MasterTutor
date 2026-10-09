import {
  ATTR,
  DERIVED_METRIC,
  type AttributeName,
  type MetricSpec,
  type SpanName,
} from "@mastertutor/contracts/telemetry";
import { o2Label, o2StreamName } from "../names.ts";

/** Labels spanmetrics adds itself (OpenObserve names), next to the registered mt.* dimensions. */
type Label = AttributeName | "span_name" | "service_name" | "status_code" | "le";

const by = (labels: readonly Label[]) =>
  labels.length === 0
    ? ""
    : ` by (${labels.map((l) => (l.startsWith("mt.") ? o2Label(l) : l)).join(", ")})`;

/** Counter increase over a window, summed by labels. */
export function increase(
  metric: MetricSpec,
  labels: readonly AttributeName[] = [],
  window = "5m",
  filter = "",
): string {
  return `sum${by(labels)} (increase(${o2StreamName(metric.name)}${filter ? `{${filter}}` : ""}[${window}]))`;
}

export function gauge(metric: MetricSpec, labels: readonly AttributeName[] = []): string {
  return `sum${by(labels)} (${o2StreamName(metric.name)})`;
}

const calls = o2StreamName(DERIVED_METRIC.spanCalls);
const duration = `${o2StreamName(DERIVED_METRIC.spanDuration)}_bucket`;
const spanFilter = (span: SpanName, extra = "") =>
  `span_name="${span}"${extra ? `, ${extra}` : ""}`;
export const SPAN_ERROR = `status_code="STATUS_CODE_ERROR"`;

/** Calls of one product span over a window, split by labels (spanmetrics, spec §5.3). */
export function spanCalls(
  span: SpanName,
  labels: readonly Label[] = [],
  extra = "",
  window = "5m",
): string {
  return `sum${by(labels)} (increase(${calls}{${spanFilter(span, extra)}}[${window}]))`;
}

/** Calls of every span over a window, split by labels. */
export function allSpanCalls(labels: readonly Label[], extra = "", window = "5m"): string {
  return `sum${by(labels)} (increase(${calls}${extra ? `{${extra}}` : ""}[${window}]))`;
}

/**
 * Events counted over the last `minutes` (review I1). OTel counters and spanmetrics start a series
 * at its first value (1, not 0), and a restarted process starts new series (their `start_time`
 * label differs), so increase() reads a process's first event as no change. A series is new when it
 * has no samples before the window; then all of its value counts. The window's baseline reaches one
 * minute back, past the 30 s export interval. OpenObserve v1.0.4's `or` and `unless` are unusable
 * (o2-api.ts), hence the `== bool` weight.
 */
export function eventsWithin(
  selector: string,
  minutes: number,
  labels: readonly Label[] = [],
): string {
  const span = `${minutes + 1}m`;
  const before = `${2 * (minutes + 1)}m`;
  const baseline = `min_over_time(${selector}[${span}])`;
  const isNew = `(count_over_time(${selector}[${span}]) == bool count_over_time(${selector}[${before}]))`;
  return `sum${by(labels)} (max_over_time(${selector}[${minutes}m]) - ${baseline} + ${baseline} * ${isNew})`;
}

/** The selector of one counter, optionally filtered. */
export function metricSelector(metric: MetricSpec, filter = ""): string {
  return `${o2StreamName(metric.name)}${filter ? `{${filter}}` : ""}`;
}

/** The spanmetrics calls selector of one product span. */
export function spanCallsSelector(span: SpanName, extra = ""): string {
  return `${calls}{${spanFilter(span, extra)}}`;
}

/** Error rate of one product span (0..1). */
export function spanErrorRate(span: SpanName, labels: readonly AttributeName[] = []): string {
  return `${spanCalls(span, labels, SPAN_ERROR)} / ${spanCalls(span, labels)}`;
}

/** A latency quantile in ms of one product span. */
export function spanQuantile(
  q: number,
  span: SpanName,
  labels: readonly AttributeName[] = [],
): string {
  return `histogram_quantile(${q}, sum${by(["le", ...labels])} (rate(${duration}{${spanFilter(span)}}[5m])))`;
}

/** p95 of outgoing HTTP by dependency (set by the collector). */
export function dependencyP95(): string {
  const dependency = o2Label(ATTR.dependency);
  return `histogram_quantile(0.95, sum by (le, ${dependency}) (rate(${duration}{${dependency}!=""}[5m])))`;
}
