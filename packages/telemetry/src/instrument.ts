import { context, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { withRunId } from "@mastertutor/contracts/server";
import {
  ATTR,
  ERROR_CODE_PATTERN,
  TRACER_NAME,
  type ProductAttributes,
  type SpanName,
} from "@mastertutor/contracts/telemetry";

const MAX_STRING = 256;
const MAX_ITEMS = 16;
const MAX_ITEM = 64;

export interface ProductSpan {
  set(attributes: ProductAttributes): void;
  /** Marks the span failed with a product code (never a message) without throwing. */
  fail(code: string): void;
}

export interface InstrumentOptions {
  /** An interruption that is not a failure (takeover, kill, …): returns its cause, else null. */
  expected?(error: unknown): string | null;
}

export function normalizeCode(code: string): string {
  return ERROR_CODE_PATTERN.test(code) ? code : "unknown_error";
}

/** A product error code for any thrown value: `code` if valid, else the snake-cased name. */
export function errorCodeOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown_error";
  const { code, name } = error as { code?: unknown; name?: unknown };
  if (typeof code === "string" && ERROR_CODE_PATTERN.test(code)) return code;
  if (typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,62}$/.test(name))
    return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return "unknown_error";
}

const typeOf = (error: unknown) =>
  error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "unknown";

function clean(attributes: ProductAttributes): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (Array.isArray(value))
      out[key] = value.slice(0, MAX_ITEMS).map((item) => String(item).slice(0, MAX_ITEM));
    else out[key] = value as number | boolean;
  }
  return out;
}

function productSpan(span: Span): ProductSpan {
  return {
    set: (attributes) => {
      try {
        span.setAttributes(clean(attributes));
      } catch {
        // Telemetry never breaks the work it describes.
      }
    },
    fail: (code) => {
      const normalized = normalizeCode(code);
      span.setAttribute(ATTR.errorCode, normalized);
      span.setStatus({ code: SpanStatusCode.ERROR, message: normalized });
    },
  };
}

const NOOP_SPAN: ProductSpan = { set: () => undefined, fail: () => undefined };

/**
 * Runs `work` inside a product span (spec §7). Errors are recorded by product code only, as status
 * ERROR plus an `exception` event naming the type; recordException is never used (a message can
 * quote page text). A run id also goes on the log context, so every line inside carries run_id.
 * If the span cannot start, the work runs without one.
 */
export function instrument<T>(
  name: SpanName,
  attributes: ProductAttributes,
  work: (span: ProductSpan) => Promise<T>,
  options: InstrumentOptions = {},
): Promise<T> {
  let started = false;
  try {
    const runId = attributes[ATTR.runId];
    const parent = runId ? withRunId(context.active(), runId) : context.active();
    // Not async itself: the span's callback is the only promise hop telemetry adds (spec §15).
    return trace
      .getTracer(TRACER_NAME)
      .startActiveSpan(name, { attributes: clean(attributes) }, parent, async (span) => {
        started = true;
        try {
          return await work(productSpan(span));
        } catch (error) {
          const expected = options.expected?.(error) ?? null;
          if (expected) span.setAttribute(ATTR.interruption, expected.slice(0, MAX_ITEM));
          else {
            productSpan(span).fail(errorCodeOf(error));
            span.addEvent("exception", { "exception.type": typeOf(error) });
          }
          throw error;
        } finally {
          span.end();
        }
      });
  } catch (error) {
    return started ? Promise.reject(error) : work(NOOP_SPAN);
  }
}
