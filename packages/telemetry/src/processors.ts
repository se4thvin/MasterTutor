import { TraceFlags } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type {
  LogRecordExporter,
  LogRecordProcessor,
  ReadableLogRecord,
  SdkLogRecord,
} from "@opentelemetry/sdk-logs";
import type { PushMetricExporter, ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { DropReason } from "@mastertutor/contracts/telemetry";
import { BoundedBatcher } from "./batcher.ts";

export interface QueueLimits {
  maxQueue: number;
  maxBatch: number;
  intervalMs: number;
}
export const DEFAULT_LIMITS: QueueLimits = { maxQueue: 2_048, maxBatch: 512, intervalMs: 2_000 };
export const EXPORT_TIMEOUT_MS = 5_000;
type OnDrop = (count: number, reason: DropReason) => void;

/** One exporter call as a promise; a non-success result rejects. */
export function exportOnce<T>(
  exporter: { export(items: T[], done: (result: ExportResult) => void): void },
  items: T[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      exporter.export(items, (result) =>
        result.code === ExportResultCode.SUCCESS
          ? resolve()
          : reject(result.error ?? new Error("export failed")),
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error("export threw"));
    }
  });
}

export class BoundedSpanProcessor implements SpanProcessor {
  readonly #exporter: SpanExporter;
  readonly #batcher: BoundedBatcher<ReadableSpan>;

  constructor(exporter: SpanExporter, limits: QueueLimits, onDrop: OnDrop) {
    this.#exporter = exporter;
    this.#batcher = new BoundedBatcher({ ...limits, onDrop, send: (b) => exportOnce(exporter, b) });
  }

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    if ((span.spanContext().traceFlags & TraceFlags.SAMPLED) !== 0) this.#batcher.add(span);
  }

  forceFlush(): Promise<void> {
    return this.#batcher.flush();
  }

  async shutdown(): Promise<void> {
    await this.#batcher.shutdown();
    await this.#exporter.shutdown().catch(() => undefined);
  }
}

export class BoundedLogProcessor implements LogRecordProcessor {
  readonly #exporter: LogRecordExporter;
  readonly #batcher: BoundedBatcher<ReadableLogRecord>;

  constructor(exporter: LogRecordExporter, limits: QueueLimits, onDrop: OnDrop) {
    this.#exporter = exporter;
    this.#batcher = new BoundedBatcher({ ...limits, onDrop, send: (b) => exportOnce(exporter, b) });
  }

  onEmit(record: SdkLogRecord): void {
    this.#batcher.add(record);
  }

  forceFlush(): Promise<void> {
    return this.#batcher.flush();
  }

  async shutdown(): Promise<void> {
    await this.#batcher.shutdown();
    await this.#exporter.shutdown().catch(() => undefined);
  }
}

/** Metrics are aggregated in memory (bounded by cardinality); a failed push is counted once. */
export class CountingMetricExporter implements PushMetricExporter {
  readonly #inner: PushMetricExporter;
  readonly #onFailed: () => void;
  readonly selectAggregationTemporality: PushMetricExporter["selectAggregationTemporality"];
  readonly selectAggregation: PushMetricExporter["selectAggregation"];

  constructor(inner: PushMetricExporter, onFailed: () => void) {
    this.#inner = inner;
    this.#onFailed = onFailed;
    this.selectAggregationTemporality = inner.selectAggregationTemporality?.bind(inner);
    this.selectAggregation = inner.selectAggregation?.bind(inner);
  }

  export(metrics: ResourceMetrics, done: (result: ExportResult) => void): void {
    try {
      this.#inner.export(metrics, (result) => {
        if (result.code !== ExportResultCode.SUCCESS) this.#onFailed();
        done(result);
      });
    } catch (error) {
      this.#onFailed();
      done({ code: ExportResultCode.FAILED, error: error instanceof Error ? error : undefined });
    }
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }
}
