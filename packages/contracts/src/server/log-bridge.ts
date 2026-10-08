/**
 * pino → OpenTelemetry logs (D50, spec §9). The only contracts module that touches OTel, and only
 * its API packages: with no SDK registered every call is a no-op, and the stream does no work at all
 * until @mastertutor/telemetry calls enableLogBridge(). It receives each line after pino has
 * serialised and redacted it, so it can never see a secret pino removed, and it exports only the
 * LOG_FIELDS allowlist: an err, a message or a user id stays on stdout.
 */
import { context, createContextKey, trace, type Context } from "@opentelemetry/api";
import { logs, SeverityNumber, type AnyValueMap } from "@opentelemetry/api-logs";
import type { DestinationStream } from "pino";
import { LOG_FIELDS } from "../telemetry.ts";

const RUN_ID = createContextKey("mt.run.id");
/** Lines from the telemetry package itself (drop warnings) never re-enter the bridge. */
export const BRIDGE_SKIP_MODULE = "telemetry";
/** pino's own fields: the record's severity, time, body and context, not attributes. */
const RECORD_FIELDS = new Set(["level", "time", "msg", "pid", "hostname", "trace_id", "span_id"]);
const SEVERITY: Record<number, [SeverityNumber, string]> = {
  10: [SeverityNumber.TRACE, "TRACE"],
  20: [SeverityNumber.DEBUG, "DEBUG"],
  30: [SeverityNumber.INFO, "INFO"],
  40: [SeverityNumber.WARN, "WARN"],
  50: [SeverityNumber.ERROR, "ERROR"],
  60: [SeverityNumber.FATAL, "FATAL"],
};

interface BridgeState {
  enabled: boolean;
  onDropped: ((count: number) => void) | null;
}
/**
 * One switch per process, on globalThis as the OTel API keeps its own state: Next.js bundles
 * contracts once per layer, and the copy instrumentation.ts enables must be the one routes use.
 */
const STATE_KEY = Symbol.for("mastertutor.logBridge");
const state = ((globalThis as Record<symbol, unknown>)[STATE_KEY] ??= {
  enabled: false,
  onDropped: null,
}) as BridgeState;

/** Turns the bridge on; `onDropped` counts the fields it kept off the export (not_allowed). */
export function enableLogBridge(onDropped?: (count: number) => void): void {
  state.onDropped = onDropped ?? null;
  state.enabled = true;
}

export function disableLogBridge(): void {
  state.enabled = false;
  state.onDropped = null;
}

/** The context that makes every log line inside it carry run_id (instrument() sets it). */
export function withRunId(parent: Context, runId: string): Context {
  return parent.setValue(RUN_ID, runId);
}

/** pino mixin: ids of the active span and run, only those that exist. */
export function logCorrelation(): { trace_id?: string; span_id?: string; run_id?: string } {
  const active = context.active();
  const fields: { trace_id?: string; span_id?: string; run_id?: string } = {};
  const span = trace.getSpan(active)?.spanContext();
  if (span && trace.isSpanContextValid(span)) {
    fields.trace_id = span.traceId;
    fields.span_id = span.spanId;
  }
  const runId = active.getValue(RUN_ID);
  if (typeof runId === "string") fields.run_id = runId;
  return fields;
}

/** A pino destination that emits each (already redacted) line as an OTel LogRecord. */
export function otelLogStream(service: string): DestinationStream {
  return {
    write(line: string): void {
      if (!state.enabled) return;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        if (record.module === BRIDGE_SKIP_MODULE) return;
        const [severityNumber, severityText] = SEVERITY[Number(record.level)] ?? [
          SeverityNumber.UNSPECIFIED,
          "UNSPECIFIED",
        ];
        const attributes: AnyValueMap = {};
        let dropped = 0;
        for (const [key, value] of Object.entries(record)) {
          if (LOG_FIELDS.has(key)) attributes[key] = value as AnyValueMap[string];
          else if (!RECORD_FIELDS.has(key)) dropped += 1;
        }
        if (dropped > 0) state.onDropped?.(dropped);
        logs.getLogger(service).emit({
          severityNumber,
          severityText,
          body: typeof record.msg === "string" ? record.msg : "",
          attributes,
          context: context.active(),
        });
      } catch {
        // A line the bridge cannot read is still on stdout; telemetry never breaks logging.
      }
    },
  };
}
