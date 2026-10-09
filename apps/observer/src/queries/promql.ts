import { parser } from "@prometheus-io/lezer-promql";
import { ATTR, DERIVED_METRIC, METRIC, o2StreamName } from "@mastertutor/contracts/telemetry";

import { promqlBudgetError, type QueryRange } from "./promql-budget.ts";

export type QueryCheck = { ok: true } | { ok: false; error: string };

const HISTOGRAM_PARTS = ["_bucket", "_sum", "_count"] as const;
const metricNames = (): string[] => {
  const names: string[] = [];
  for (const metric of Object.values(METRIC)) {
    const base = o2StreamName(metric.name);
    names.push(base);
    if (metric.kind === "histogram") names.push(...HISTOGRAM_PARTS.map((part) => `${base}${part}`));
  }
  names.push(o2StreamName(DERIVED_METRIC.spanCalls));
  names.push(
    ...HISTOGRAM_PARTS.map((part) => `${o2StreamName(DERIVED_METRIC.spanDuration)}${part}`),
  );
  return names;
};
/** Registry names only (CP §1: invented names are the main text-to-query failure). */
export const PROMQL_METRICS: ReadonlySet<string> = new Set(metricNames());
/** Registry attributes plus the labels spanmetrics and histograms add themselves. */
export const PROMQL_LABELS: ReadonlySet<string> = new Set([
  ...Object.values(ATTR).map(o2StreamName),
  "span_name",
  "service_name",
  "status_code",
  "le",
]);

const MAX_QUERY = 2_000;

/**
 * Parses with the official grammar, then checks every metric selector and label against the
 * registry. Errors list the valid names so the model can correct itself (spec §7.4).
 */
export function checkPromql(query: string, range?: QueryRange): QueryCheck {
  const now = Math.floor(Date.now() / 1000);
  const evaluation = range ?? { start: now, end: now, step: 1 };
  if (query.length === 0 || query.length > MAX_QUERY)
    return { ok: false, error: `PromQL must be 1–${MAX_QUERY} characters.` };
  const tree = parser.parse(query);
  let error: string | null = null;
  tree.iterate({
    enter(node) {
      if (error) return false;
      if (node.type.isError) {
        error = `PromQL syntax error near position ${node.from}.`;
        return false;
      }
      if (node.name === "VectorSelector" && !node.node.getChild("Identifier")) {
        error = "A registry metric name is required on every selector.";
        return false;
      }
      const text = query.slice(node.from, node.to);
      if (
        node.name === "Identifier" &&
        node.node.parent?.name === "VectorSelector" &&
        !PROMQL_METRICS.has(text)
      )
        error = `Unknown metric "${text}". Valid metrics: ${[...PROMQL_METRICS].join(", ")}.`;
      if (node.name === "LabelName" && (text === "__name__" || !PROMQL_LABELS.has(text)))
        error = `Unknown label "${text}". Valid labels: ${[...PROMQL_LABELS].join(", ")}.`;
      return undefined;
    },
  });
  error ??= promqlBudgetError(query, tree.topNode, evaluation);
  return error ? { ok: false, error } : { ok: true };
}
