/**
 * pino → OpenTelemetry logs (D50, spec §9). The only contracts module that touches OTel, and only
 * its API packages: with no SDK registered every call is a no-op, and the stream does no work at all
 * until @mastertutor/telemetry calls enableLogBridge(). It receives each line after pino has
 * serialised and redacted it, so it can never see a secret pino removed.
 */
import { context, createContextKey, trace, type Context } from "@opentelemetry/api";
import { logs, SeverityNumber, type AnyValueMap } from "@opentelemetry/api-logs";
import type { DestinationStream } from "pino";

const RUN_ID = createContextKey("mt.run.id");
/** Lines from the telemetry package itself (drop warnings) never re-enter the bridge. */
export const BRIDGE_SKIP_MODULE = "telemetry";
const NOT_ATTRIBUTES = new Set(["level", "time", "msg", "pid", "hostname", "trace_id", "span_id"]);
const SEVERITY: Record<number, [SeverityNumber, string]> = {
  10: [SeverityNumber.TRACE, "TRACE"],
  20: [SeverityNumber.DEBUG, "DEBUG"],
  30: [SeverityNumber.INFO, "INFO"],
  40: [SeverityNumber.WARN, "WARN"],
  50: [SeverityNumber.ERROR, "ERROR"],
  60: [SeverityNumber.FATAL, "FATAL"],
};

let enabled = false;

export function enableLogBridge(): void {
  enabled = true;
}

export function disableLogBridge(): void {
  enabled = false;
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
      if (!enabled) return;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        if (record.module === BRIDGE_SKIP_MODULE) return;
        const [severityNumber, severityText] = SEVERITY[Number(record.level)] ?? [
          SeverityNumber.UNSPECIFIED,
          "UNSPECIFIED",
        ];
        const attributes: AnyValueMap = {};
        for (const [key, value] of Object.entries(record))
          if (!NOT_ATTRIBUTES.has(key)) attributes[key] = value as AnyValueMap[string];
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
