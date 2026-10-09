import type { AlertRule } from "@mastertutor/contracts";
import { ATTR, DERIVED_METRIC, LOG_STREAMS, METRIC, SPAN } from "@mastertutor/contracts/telemetry";
import type { O2Client } from "./client.ts";
import {
  SPAN_ERROR,
  eventsWithin,
  metricSelector,
  spanCallsSelector,
} from "./dashboards/queries.ts";
import { o2Label, o2StreamName } from "./names.ts";
import { AlertList, O2_FIELDS, O2_ALERT_TRIGGER_THRESHOLD, o2Paths } from "./o2-api.ts";
import { ALERT_DESTINATION_NAME, ensureStream } from "./provision.ts";

export interface AlertSpec {
  description: string;
  query:
    { type: "promql"; expr: string; stream: string } | { type: "sql"; stream: string; sql: string };
  /** Fires when the value is at least this. */
  threshold: number;
  periodMinutes: number;
}

const SILENCE_MINUTES = 30;
const ERROR_SPIKE_LINES = 20;

/** The five alert rules (spec §13.1). Their names are AlertRule, which web validates. */
export function alertSpecs(options: { spendUsdPerHour: number }): Record<AlertRule, AlertSpec> {
  return {
    error_spike: {
      description: "20 or more error lines in the app log within 5 minutes.",
      query: {
        type: "sql",
        stream: LOG_STREAMS.app,
        // OpenObserve's SQL threshold counts rows, so the count lives in HAVING (B1).
        sql: `SELECT count(*) AS value FROM "${LOG_STREAMS.app}" WHERE ${O2_FIELDS.logSeverity} IN ('ERROR', 'FATAL') HAVING count(*) >= ${ERROR_SPIKE_LINES}`,
      },
      threshold: ERROR_SPIKE_LINES,
      periodMinutes: 5,
    },
    model_request_rejected: {
      description: "A run failed because the model rejected its request.",
      query: {
        type: "promql",
        stream: o2StreamName(METRIC.runFailures.name),
        expr: eventsWithin(
          metricSelector(METRIC.runFailures, `${o2Label(ATTR.errorCode)}="model_request_rejected"`),
          5,
        ),
      },
      threshold: 1,
      periodMinutes: 5,
    },
    run_failed: {
      description: "A run ended as failed.",
      query: {
        type: "promql",
        stream: o2StreamName(METRIC.runsEnded.name),
        expr: eventsWithin(
          metricSelector(METRIC.runsEnded, `${o2Label(ATTR.runStatus)}="failed"`),
          5,
        ),
      },
      threshold: 1,
      periodMinutes: 5,
    },
    slot_crash_loop: {
      description: "One browser slot failed to restart 3 times within 10 minutes.",
      query: {
        type: "promql",
        stream: o2StreamName(DERIVED_METRIC.spanCalls),
        expr: `max(${eventsWithin(spanCallsSelector(SPAN.slotReset, SPAN_ERROR), 10, [ATTR.slotName])})`,
      },
      threshold: 3,
      periodMinutes: 10,
    },
    spend_jump: {
      description: `Committed spend rose by more than $${options.spendUsdPerHour} within an hour.`,
      query: {
        type: "promql",
        stream: o2StreamName(METRIC.spendUsd.name),
        expr: eventsWithin(metricSelector(METRIC.spendUsd), 60),
      },
      threshold: options.spendUsdPerHour,
      periodMinutes: 60,
    },
  };
}

/** OpenObserve v2 alert JSON (shape pinned by alerts.int.test.ts against the digest). */
export function toO2Alert(rule: AlertRule, spec: AlertSpec): Record<string, unknown> {
  const promql = spec.query.type === "promql";
  return {
    name: rule,
    description: spec.description,
    stream_type: promql ? "metrics" : "logs",
    stream_name: spec.query.stream,
    is_real_time: false,
    enabled: true,
    query_condition:
      spec.query.type === "promql"
        ? {
            type: "promql",
            promql: spec.query.expr,
            promql_condition: { column: "value", operator: ">=", value: spec.threshold },
            conditions: null,
            sql: null,
          }
        : {
            type: "sql",
            sql: spec.query.sql,
            conditions: null,
            promql: null,
            promql_condition: null,
          },
    // PromQL: one matching series fires. SQL: one returned row fires (the count is in HAVING).
    trigger_condition: {
      period: spec.periodMinutes,
      operator: ">=",
      threshold: O2_ALERT_TRIGGER_THRESHOLD,
      frequency: 1,
      frequency_type: "minutes",
      silence: SILENCE_MINUTES,
    },
    destinations: [ALERT_DESTINATION_NAME],
    context_attributes: {},
  };
}

/** Creates or replaces the five alerts by name; each one's stream is created first (B1). */
export async function upsertAlerts(
  client: O2Client,
  options: { spendUsdPerHour: number },
): Promise<void> {
  const list = await client.call(
    "listAlerts",
    "GET",
    o2Paths.alerts(client.org),
    undefined,
    AlertList,
  );
  const existing = new Map(list.list.map((alert) => [alert.name, alert.alert_id] as const));
  for (const [rule, spec] of Object.entries(alertSpecs(options)) as Array<[AlertRule, AlertSpec]>) {
    await ensureStream(
      client,
      spec.query.stream,
      spec.query.type === "promql" ? "metrics" : "logs",
    );
    const body = toO2Alert(rule, spec);
    const id = existing.get(rule);
    if (id) await client.call("updateAlert", "PUT", o2Paths.alert(client.org, id), body);
    else await client.call("createAlert", "POST", o2Paths.alerts(client.org), body);
  }
}
