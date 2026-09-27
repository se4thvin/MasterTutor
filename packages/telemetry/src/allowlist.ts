import type { Attributes, SpanStatus } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ATTR, ERROR_CODE_PATTERN, EXPORTABLE_ATTRIBUTES } from "@mastertutor/contracts/telemetry";

const FULL_URL = /[a-z][a-z0-9+.-]*:\/\/\S*/gi;

/** A full URL (scheme://host/path?query) never leaves: Next.js names fetch spans after one (I2). */
function withoutUrls(text: string): string {
  return text.includes("://") ? text.replace(FULL_URL, "[url]") : text;
}

function allowed(attributes: Attributes, onDropped: (count: number) => void): Attributes {
  const kept: Attributes = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(attributes)) {
    if (EXPORTABLE_ATTRIBUTES.has(key))
      kept[key] = typeof value === "string" ? withoutUrls(value) : value;
    else dropped += 1;
  }
  if (dropped > 0) onDropped(dropped);
  return kept;
}

/**
 * A status message is free text (third-party spans put the raw error there, review C1): it is
 * replaced by the span's product error code, or dropped when the span has none.
 */
function statusOf(span: ReadableSpan): SpanStatus {
  const code = span.attributes[ATTR.errorCode];
  return typeof code === "string" && ERROR_CODE_PATTERN.test(code)
    ? { code: span.status.code, message: code }
    : { code: span.status.code };
}

/**
 * The runtime half of the attribute allowlist (spec §5.2): every span leaves with product and
 * listed base attributes only, no full URL in a name or value, and no status message; links are
 * dropped (we never link traces). The span itself is not mutated: a plain copy is exported
 * (cheaper than a prototype view).
 */
export class AllowlistSpanExporter implements SpanExporter {
  readonly #inner: SpanExporter;
  readonly #onDropped: (count: number) => void;

  constructor(inner: SpanExporter, onDropped: (count: number) => void) {
    this.#inner = inner;
    this.#onDropped = onDropped;
  }

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    const views = spans.map((span): ReadableSpan => ({
      name: withoutUrls(span.name),
      kind: span.kind,
      spanContext: () => span.spanContext(),
      parentSpanContext: span.parentSpanContext,
      startTime: span.startTime,
      endTime: span.endTime,
      status: statusOf(span),
      attributes: allowed(span.attributes, this.#onDropped),
      links: [],
      events: span.events.map((event) => ({
        ...event,
        name: withoutUrls(event.name),
        attributes: event.attributes ? allowed(event.attributes, this.#onDropped) : undefined,
      })),
      duration: span.duration,
      ended: span.ended,
      resource: span.resource,
      instrumentationScope: span.instrumentationScope,
      droppedAttributesCount: span.droppedAttributesCount,
      droppedEventsCount: span.droppedEventsCount,
      droppedLinksCount: span.droppedLinksCount,
    }));
    this.#inner.export(views, done);
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush?.() ?? Promise.resolve();
  }
}
