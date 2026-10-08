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
