import type { Attributes } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { EXPORTABLE_ATTRIBUTES } from "@mastertutor/contracts/telemetry";

function allowed(attributes: Attributes, onDropped: (count: number) => void): Attributes {
  const kept: Attributes = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(attributes)) {
    if (EXPORTABLE_ATTRIBUTES.has(key)) kept[key] = value;
    else dropped += 1;
  }
  if (dropped > 0) onDropped(dropped);
  return kept;
}

/**
 * The runtime half of the attribute allowlist (spec §5.2): every span leaves with product and
 * listed base attributes only; links are dropped (we never link traces). The span itself is not
 * mutated: a plain copy with filtered attributes is exported (cheaper than a prototype view).
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
      name: span.name,
      kind: span.kind,
      spanContext: () => span.spanContext(),
      parentSpanContext: span.parentSpanContext,
      startTime: span.startTime,
      endTime: span.endTime,
      status: span.status,
      attributes: allowed(span.attributes, this.#onDropped),
      links: [],
      events: span.events.map((event) => ({
        ...event,
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
