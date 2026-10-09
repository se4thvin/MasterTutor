import { ATTR, LOG_STREAMS, METRIC, SPAN, TRACE_STREAM } from "@mastertutor/contracts/telemetry";
import { o2Label } from "../names.ts";
import { O2_FIELDS, O2_TRACE_ERROR_STATUS } from "../o2-api.ts";
import type { DashboardSpec, PanelQuery } from "./build.ts";
import {
  SPAN_ERROR,
  allSpanCalls,
  dependencyP95,
  gauge,
  increase,
  spanCalls,
  spanErrorRate,
  spanQuantile,
} from "./queries.ts";

const { timestamp, logSeverity, logBody, serviceName } = O2_FIELDS;
const service = o2Label(ATTR.service);
const errorCode = o2Label(ATTR.errorCode);

const appLogErrors: PanelQuery = {
  type: "sql",
  stream: LOG_STREAMS.app,
  streamType: "logs",
  sql: `SELECT histogram(${timestamp}) AS x_axis_1, ${serviceName} AS y_axis_2, count(*) AS y_axis_1 FROM "${LOG_STREAMS.app}" WHERE ${logSeverity} IN ('ERROR', 'FATAL') GROUP BY x_axis_1, y_axis_2 ORDER BY x_axis_1`,
};
/** Container lines carry no reliable level, so errors are lines that say so (spec §13.1). */
const containerErrors: PanelQuery = {
  type: "sql",
  stream: LOG_STREAMS.containers,
  streamType: "logs",
  sql: `SELECT histogram(${timestamp}) AS x_axis_1, ${service} AS y_axis_2, count(*) AS y_axis_1 FROM "${LOG_STREAMS.containers}" WHERE str_match_ignore_case(${logBody}, 'error') GROUP BY x_axis_1, y_axis_2 ORDER BY x_axis_1`,
};
const slowOrFailedTraces: PanelQuery = {
  type: "sql",
  stream: TRACE_STREAM,
  streamType: "traces",
  // Durations are microseconds: 15 s, the tail sampler's slow threshold.
  sql: `SELECT ${O2_FIELDS.traceId}, ${O2_FIELDS.traceOperation}, ${O2_FIELDS.traceDurationMicros}, ${errorCode} FROM "${TRACE_STREAM}" WHERE ${O2_FIELDS.traceStatus} = '${O2_TRACE_ERROR_STATUS}' OR ${O2_FIELDS.traceDurationMicros} > 15000000 ORDER BY ${timestamp} DESC LIMIT 50`,
};
const promql = (expr: string): PanelQuery => ({ type: "promql", expr });

export const DASHBOARDS: readonly DashboardSpec[] = [
  {
    title: "MasterTutor · System health",
    description: "Errors, dependencies and the telemetry pipeline itself (D50).",
    panels: [
      {
        title: "Span error rate by service",
        kind: "line",
        query: promql(
          `${allSpanCalls(["service_name"], SPAN_ERROR)} / ${allSpanCalls(["service_name"])}`,
        ),
      },
      { title: "Dependency p95 (ms)", kind: "line", query: promql(dependencyP95()) },
      {
        title: "Telemetry dropped",
        kind: "bar",
        query: promql(increase(METRIC.telemetryDropped, [ATTR.telemetrySignal, ATTR.dropReason])),
      },
      { title: "Container log errors", kind: "bar", query: containerErrors },
    ],
  },
  {
    title: "MasterTutor · Runs and agent",
    description: "Runs, steps per phase, tools, approvals and takeovers.",
    panels: [
      {
        title: "Runs ended",
        kind: "bar",
        query: promql(increase(METRIC.runsEnded, [ATTR.runStatus], "1h")),
      },
      { title: "Active runs", kind: "line", query: promql(gauge(METRIC.activeRuns)) },
      {
        title: "Step p50 by phase (ms)",
        kind: "line",
        query: promql(spanQuantile(0.5, SPAN.step, [ATTR.stepPhase])),
      },
      {
        title: "Step p95 by phase (ms)",
        kind: "line",
        query: promql(spanQuantile(0.95, SPAN.step, [ATTR.stepPhase])),
      },
      {
        title: "Step outcomes",
        kind: "bar",
        query: promql(spanCalls(SPAN.step, [ATTR.stepOutcome])),
      },
      { title: "Tool calls", kind: "bar", query: promql(spanCalls(SPAN.tool, [ATTR.toolName])) },
      {
        title: "Tool error rate",
        kind: "line",
        query: promql(spanErrorRate(SPAN.tool, [ATTR.toolName])),
      },
      {
        title: "Tool p95 (ms)",
        kind: "line",
        query: promql(spanQuantile(0.95, SPAN.tool, [ATTR.toolName])),
      },
      {
        title: "Approvals requested",
        kind: "bar",
        query: promql(increase(METRIC.approvalsRequested, [ATTR.approvalKind], "1h")),
      },
      {
        title: "Approvals resolved",
        kind: "bar",
        query: promql(
          increase(METRIC.approvalsResolved, [ATTR.approvalStatus, ATTR.approvalDecider], "1h"),
        ),
      },
    ],
  },
  {
    title: "MasterTutor · Model and spend",
    description: "Spend, tokens, model latency, fallbacks and rejections.",
    panels: [
      {
        title: "Spend per hour (USD)",
        kind: "bar",
        query: promql(increase(METRIC.spendUsd, [], "1h")),
      },
      {
        title: "Spend per day (USD)",
        kind: "metric",
        query: promql(increase(METRIC.spendUsd, [], "24h")),
      },
      {
        title: "Tokens by model and type",
        kind: "line",
        query: promql(increase(METRIC.modelTokens, [ATTR.modelName, ATTR.tokenType])),
      },
      {
        title: "Model request p95 (ms)",
        kind: "line",
        query: promql(spanQuantile(0.95, SPAN.modelRequest, [ATTR.modelName])),
      },
      {
        title: "Fallbacks",
        kind: "bar",
        query: promql(increase(METRIC.modelFallbacks, [ATTR.modelName], "1h")),
      },
      {
        title: "Model failures by code",
        kind: "bar",
        query: promql(spanCalls(SPAN.modelRequest, [ATTR.errorCode], SPAN_ERROR)),
      },
      { title: "Budget hits", kind: "bar", query: promql(increase(METRIC.budgetHits, [], "1h")) },
    ],
  },
  {
    title: "MasterTutor · Capture fidelity",
    description: "Capture verdicts, blocks and filing.",
    panels: [
      {
        title: "Captures by fidelity",
        kind: "bar",
        query: promql(
          spanCalls(SPAN.tool, [ATTR.captureFidelity], `${o2Label(ATTR.toolName)}="capture"`),
        ),
      },
      {
        title: "Capture p95 (ms)",
        kind: "line",
        query: promql(spanQuantile(0.95, SPAN.tool, [ATTR.captureFidelity])),
      },
      {
        title: "Blocks added",
        kind: "bar",
        query: promql(increase(METRIC.blocksAdded, [ATTR.blockType, ATTR.blockOrigin], "1h")),
      },
      {
        title: "Notes filed",
        kind: "bar",
        query: promql(increase(METRIC.notesFiled, [ATTR.filedBy], "1h")),
      },
    ],
  },
  {
    title: "MasterTutor · Slots and live view",
    description: "Slot states, leases, resets, takeovers and live streams.",
    panels: [
      {
        title: "Slots by state",
        kind: "line",
        query: promql(gauge(METRIC.slots, [ATTR.slotState])),
      },
      {
        title: "Slot leases",
        kind: "bar",
        query: promql(increase(METRIC.slotLeases, [ATTR.slotOutcome], "1h")),
      },
      {
        title: "Slot reset p95 (ms)",
        kind: "line",
        query: promql(spanQuantile(0.95, SPAN.slotReset, [ATTR.slotName])),
      },
      {
        title: "Slot reset timeouts",
        kind: "bar",
        query: promql(spanCalls(SPAN.slotReset, [ATTR.slotName], SPAN_ERROR)),
      },
      {
        title: "Takeovers by outcome",
        kind: "bar",
        query: promql(spanCalls(SPAN.takeover, [ATTR.takeoverOutcome])),
      },
      {
        title: "Takeover p95 (ms)",
        kind: "line",
        query: promql(spanQuantile(0.95, SPAN.takeover)),
      },
      {
        title: "Run event streams open",
        kind: "line",
        query: promql(gauge(METRIC.sseConnections)),
      },
      { title: "Browser container errors", kind: "bar", query: containerErrors },
    ],
  },
  {
    title: "MasterTutor · Errors",
    description: "Every error by product code, span and log stream.",
    panels: [
      {
        title: "Run failures by code",
        kind: "bar",
        query: promql(increase(METRIC.runFailures, [ATTR.errorCode], "1h")),
      },
      {
        title: "Run errors by code",
        kind: "bar",
        query: promql(increase(METRIC.runErrors, [ATTR.errorCode], "1h")),
      },
      {
        title: "Error spans by code",
        kind: "table",
        query: promql(allSpanCalls(["span_name", ATTR.errorCode], SPAN_ERROR, "1h")),
      },
      { title: "App log errors by service", kind: "bar", query: appLogErrors },
      { title: "Container log errors by service", kind: "bar", query: containerErrors },
      { title: "Slow or failed traces", kind: "table", query: slowOrFailedTraces },
    ],
  },
];
