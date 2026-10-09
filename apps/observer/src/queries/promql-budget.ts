import type { parser } from "@prometheus-io/lezer-promql";
import { COPILOT_LIMITS } from "@mastertutor/contracts";
import type { O2Query } from "../o2.ts";

type Node = ReturnType<typeof parser.parse>["topNode"];
export type QueryRange = Parameters<O2Query["range"]>[1];
const MAX_SECONDS = COPILOT_LIMITS.metricMaxHours * 3600;
// OpenObserve v1.0.4 src/promql/src/lib.rs: DEFAULT_LOOKBACK. No caller can override it.
const LOOKBACK_SECONDS = 300;
const UNITS: Readonly<Record<string, number>> = {
  ms: 0.001,
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  y: 31536000,
};

/** Decode only a parser-recognised duration literal, never expression text or label strings. */
function duration(text: string): number {
  const numeric = Number(text);
  if (text.trim() && Number.isFinite(numeric)) return numeric;
  let value = 0;
  let rest = text;
  let sign = 1;
  if (rest.startsWith("-") || rest.startsWith("+")) {
    sign = rest[0] === "-" ? -1 : 1;
    rest = rest.slice(1);
  }
  while (rest) {
    const part = /^(\d+(?:\.\d+)?)(ms|[smhdwy])/.exec(rest);
    if (!part) return NaN;
    value += Number(part[1]) * UNITS[part[2]!]!;
    rest = rest.slice(part[0].length);
  }
  return sign * value;
}

/**
 * Bound every branch's data window and evaluation work, including nested subqueries. Costs
 * deliberately assume no upstream cache reuse. Missing subquery resolutions fail closed rather
 * than depending on an upstream global evaluation interval we do not control.
 */
export function promqlBudgetError(query: string, root: Node, range: QueryRange): string | null {
  const outerPoints = Math.floor((range.end - range.start) / range.step) + 1;
  if (
    ![range.start, range.end, range.step].every(Number.isFinite) ||
    range.start < 0 ||
    range.end < range.start ||
    range.step <= 0 ||
    outerPoints > COPILOT_LIMITS.points
  )
    return "Invalid PromQL evaluation range.";
  let earliest = range.start;
  let latest = range.end;
  let error: string | null = null;
  const include = (start: number, end: number) => {
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
    if (!Number.isFinite(earliest) || !Number.isFinite(latest) || latest - earliest > MAX_SECONDS)
      error = "PromQL effective time window exceeds 90 days.";
  };
  const literal = (node: Node | null, signed = false): number => {
    const value = node ? duration(query.slice(node.from, node.to)) : NaN;
    if (!Number.isFinite(value) || Math.abs(value) > MAX_SECONDS || (!signed && value <= 0))
      error = "PromQL durations must be finite, positive and within 90 days.";
    return value;
  };
  const visit = (original: Node, start: number, end: number): number => {
    if (error) return 0;
    let node = original;
    let offset = 0;
    let anchor: number | null = null;
    // @ anchors before offset regardless of their textual order; modifiers can wrap each other.
    while (node.name === "OffsetExpr" || node.name === "StepInvariantExpr") {
      if (node.name === "OffsetExpr")
        offset += literal(node.getChild("NumberDurationLiteralInDurationContext"), true);
      else {
        const preprocessor = node.getChild("AtModifierPreprocessors");
        anchor = preprocessor
          ? query.slice(preprocessor.from, preprocessor.to) === "start"
            ? range.start
            : range.end
          : Number(
              query.slice(
                node.getChild("NumberDurationLiteral")?.from,
                node.getChild("NumberDurationLiteral")?.to,
              ),
            );
        if (!Number.isFinite(anchor)) error = "Invalid PromQL @ timestamp.";
      }
      if (!node.firstChild) return 0;
      node = node.firstChild;
    }
    if (anchor !== null) start = end = anchor;
    start -= offset;
    end -= offset;
    include(start, end);
    if (error) return 0;
    if (node.name === "VectorSelector") {
      include(start - LOOKBACK_SECONDS, end);
      return 1;
    }
    if (node.name === "MatrixSelector") {
      if (node.firstChild?.name !== "VectorSelector") {
        error = "PromQL range selectors must apply directly to a registry metric.";
        return 0;
      }
      include(start - literal(node.getChild("NumberDurationLiteralInDurationContext")), end);
      // The vector is part of a range selector: its explicit window replaces instant lookback.
      return 1;
    }
    if (node.name === "SubqueryExpr") {
      const literals = node.getChildren("NumberDurationLiteralInDurationContext");
      const window = literal(literals[0] ?? null);
      const resolution = literal(literals[1] ?? null);
      if (error) return 0;
      // Subquery grids are epoch-aligned. Include the leading alignment interval conservatively.
      const innerStart = Math.floor((start - window) / resolution) * resolution;
      include(innerStart, end);
      // Engines may precompute the entire inner grid between outer evaluations, including gaps.
      const points = Math.ceil((end - innerStart) / resolution) + 1;
      const cost = 1 + points * Math.max(1, visit(node.firstChild!, innerStart, end));
      if (cost * outerPoints > COPILOT_LIMITS.points)
        error = "PromQL expression exceeds 300 evaluation points.";
      return cost;
    }
    let cost = 0;
    for (let child = node.firstChild; child; child = child.nextSibling)
      cost += visit(child, start, end);
    return cost;
  };
  const cost = Math.max(1, visit(root, range.start, range.end));
  if (cost * outerPoints > COPILOT_LIMITS.points)
    error = "PromQL expression exceeds 300 evaluation points.";
  return error;
}
