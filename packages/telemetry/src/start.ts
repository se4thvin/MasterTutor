import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { CompositePropagator } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { TelemetryEnv } from "@mastertutor/contracts";
import { disableLogBridge, enableLogBridge } from "@mastertutor/contracts/server";
import type { DropReason, TelemetrySignal } from "@mastertutor/contracts/telemetry";
import { AllowlistSpanExporter } from "./allowlist.ts";
import { installCrashHandlers, type CrashMode } from "./crash.ts";
import { NOOP_HANDLE, getTelemetry, setTelemetry, within, type TelemetryHandle } from "./handle.ts";
import { resetInstruments } from "./instruments.ts";
import {
  BoundedLogProcessor,
  BoundedSpanProcessor,
  CountingMetricExporter,
  DEFAULT_LIMITS,
  EXPORT_TIMEOUT_MS,
  type QueueLimits,
} from "./processors.ts";
import { countDropped, setTelemetryLog, type Log } from "./self.ts";

export { getTelemetry, type TelemetryHandle } from "./handle.ts";

export interface StartOptions {
  service: "web" | "agent";
  env: TelemetryEnv;
  crash: CrashMode;
  log: Log;
  /** Test seam; production uses DEFAULT_LIMITS. */
  limits?: QueueLimits;
}

const drops = (signal: TelemetrySignal) => (count: number, reason: DropReason) =>
  countDropped(signal, reason, count);

/**
 * Sets up the OTel SDK once per process (spec §6.3). Without OTEL_EXPORTER_OTLP_ENDPOINT it
 * registers nothing. Propagation is off (spec §7.4). Any failure leaves telemetry off, never the
 * process down.
 */
export function startTelemetry(options: StartOptions): TelemetryHandle {
  installCrashHandlers(options.crash, options.log);
  const endpoint = options.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (getTelemetry().enabled || !endpoint) return getTelemetry();
  try {
    const base = endpoint.replace(/\/+$/, "");
    const limits = options.limits ?? DEFAULT_LIMITS;
    const resource = resourceFromAttributes({
      "service.name": options.service,
      "service.namespace": "mastertutor",
      "deployment.environment.name": options.env.MT_DEPLOYMENT,
    });
    setTelemetryLog(options.log);
    const tracer = new NodeTracerProvider({
      resource,
      spanProcessors: [
        new BoundedSpanProcessor(
          new AllowlistSpanExporter(
            new OTLPTraceExporter({ url: `${base}/v1/traces`, timeoutMillis: EXPORT_TIMEOUT_MS }),
            (count) => countDropped("traces", "not_allowed", count),
          ),
          limits,
          drops("traces"),
        ),
      ],
    });
    tracer.register({ propagator: new CompositePropagator({ propagators: [] }) });
    const meter = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new CountingMetricExporter(
            new OTLPMetricExporter({ url: `${base}/v1/metrics`, timeoutMillis: EXPORT_TIMEOUT_MS }),
            () => countDropped("metrics", "export_failed", 1),
          ),
          exportIntervalMillis: 30_000,
          exportTimeoutMillis: EXPORT_TIMEOUT_MS,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meter);
    const logger = new LoggerProvider({
      resource,
      processors: [
        new BoundedLogProcessor(
          new OTLPLogExporter({ url: `${base}/v1/logs`, timeoutMillis: EXPORT_TIMEOUT_MS }),
          limits,
          drops("logs"),
        ),
      ],
    });
    logs.setGlobalLoggerProvider(logger);
    resetInstruments();
    const unregister = registerInstrumentations({
      tracerProvider: tracer,
      meterProvider: meter,
      instrumentations: [
        // Outgoing only (the AWS SDK's S3 calls); Next.js makes web's server spans. Disabled,
        // not ignored: an ignored request would suppress every span made while serving it.
        new HttpInstrumentation({
          disableIncomingRequestInstrumentation: true,
          requireParentforOutgoingSpans: true,
        }),
        // fetch: OpenAI, docling, pdf-worker, audio-capture, n.eko admin, Web Push.
        new UndiciInstrumentation({ requireParentforSpans: true }),
      ],
    });
    enableLogBridge((count) => countDropped("logs", "not_allowed", count));
    setTelemetry({
      enabled: true,
      flush: (ms = 2_000) =>
        within(Promise.all([tracer.forceFlush(), meter.forceFlush(), logger.forceFlush()]), ms),
      shutdown: async (ms = 3_000) => {
        disableLogBridge();
        unregister();
        await within(Promise.all([tracer.shutdown(), meter.shutdown(), logger.shutdown()]), ms);
        metrics.disable();
        logs.disable();
        resetInstruments();
        setTelemetryLog(null);
        setTelemetry(NOOP_HANDLE);
      },
    });
  } catch (error) {
    options.log.warn(
      {
        module: "telemetry",
        errorCode: "telemetry_start_failed",
        err: error instanceof Error ? error.name : "unknown",
      },
      "telemetry disabled",
    );
  }
  return getTelemetry();
}
