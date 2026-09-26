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
 * mutated: a view over it with filtered attributes is exported.
 */
export class AllowlistSpanExporter implements SpanExporter {
  readonly #inner: SpanExporter;
  readonly #onDropped: (count: number) => void;

  constructor(inner: SpanExporter, onDropped: (count: number) => void) {
    this.#inner = inner;
    this.#onDropped = onDropped;
  }

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    const views = spans.map(
      (span) =>
        Object.create(span, {
          attributes: { value: allowed(span.attributes, this.#onDropped), enumerable: true },
          events: {
            value: span.events.map((event) => ({
              ...event,
              attributes: event.attributes ? allowed(event.attributes, this.#onDropped) : undefined,
            })),
            enumerable: true,
          },
          links: { value: [], enumerable: true },
        }) as ReadableSpan,
    );
    this.#inner.export(views, done);
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush?.() ?? Promise.resolve();
  }
}
