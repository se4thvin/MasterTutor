import { context, metrics, propagation, trace, type Attributes } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { CompositePropagator } from "@opentelemetry/core";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { disableLogBridge, enableLogBridge } from "@mastertutor/contracts/server";
import { AllowlistSpanExporter } from "./allowlist.ts";
import { resetInstruments } from "./instruments.ts";

export interface MetricPoint {
  value: number;
  attributes: Attributes;
}

export interface TestTelemetry {
  /** Finished spans as exported (after the allowlist). */
  spans(): ReadableSpan[];
  /** Cumulative points of one metric (a histogram's value is its sum). */
  metric(name: string): Promise<MetricPoint[]>;
  logs(): ReturnType<InMemoryLogRecordExporter["getFinishedLogRecords"]>;
  /** Everything exported, serialised: the canary tests search it. */
  exported(): Promise<string>;
  shutdown(): Promise<void>;
}

/** In-memory SDK for tests: same allowlist, no network, no propagation. */
export function installTestTelemetry(): TestTelemetry {
  const spanExporter = new InMemorySpanExporter();
  const tracer = new NodeTracerProvider({
    spanProcessors: [
      new SimpleSpanProcessor(new AllowlistSpanExporter(spanExporter, () => undefined)),
    ],
  });
  tracer.register({ propagator: new CompositePropagator({ propagators: [] }) });
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 3_600_000,
  });
  const meter = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(meter);
  const logExporter = new InMemoryLogRecordExporter();
  const logger = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
  });
  logs.setGlobalLoggerProvider(logger);
  resetInstruments();
  enableLogBridge();

  const latest = async () => {
    await reader.forceFlush();
    return metricExporter.getMetrics().at(-1);
  };
  return {
    spans: () => spanExporter.getFinishedSpans(),
    async metric(name) {
      const points: MetricPoint[] = [];
      for (const scope of (await latest())?.scopeMetrics ?? [])
        for (const metric of scope.metrics)
          if (metric.descriptor.name === name)
            for (const point of metric.dataPoints)
              points.push({
                value:
                  typeof point.value === "number"
                    ? point.value
                    : (point.value as { sum: number }).sum,
                attributes: point.attributes,
              });
      return points;
    },
    logs: () => logExporter.getFinishedLogRecords(),
    async exported() {
      return JSON.stringify({
        spans: spanExporter.getFinishedSpans().map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
        metrics: (await latest()) ?? null,
        logs: logExporter
          .getFinishedLogRecords()
          .map((record) => ({ body: record.body, attributes: record.attributes })),
      });
    },
    async shutdown() {
      disableLogBridge();
      await Promise.all([tracer.shutdown(), meter.shutdown(), logger.shutdown()]);
      trace.disable();
      metrics.disable();
      logs.disable();
      context.disable();
      propagation.disable();
      resetInstruments();
    },
  };
}
