import { metrics, type Counter, type Histogram, type UpDownCounter } from "@opentelemetry/api";
import { METER_NAME, METRIC, type MetricSpec } from "@mastertutor/contracts/telemetry";

export interface Instruments {
  runsEnded: Counter;
  runFailures: Counter;
  runErrors: Counter;
  approvalsRequested: Counter;
  approvalsResolved: Counter;
  controlChanges: Counter;
  slotLeases: Counter;
  blocksAdded: Counter;
  downloads: Counter;
  downloadSize: Histogram;
  budgetHits: Counter;
  modelFallbacks: Counter;
  notesFiled: Counter;
  modelTokens: Counter;
  spendUsd: Counter;
  sseConnections: UpDownCounter;
  alertsReceived: Counter;
  pushSends: Counter;
  telemetryDropped: Counter;
  observerVerdicts: Counter;
  observerFailures: Counter;
  observerOverrides: Counter;
  observerSpend: Counter;
}

let cache: Instruments | null = null;

/**
 * Metric instruments, created from METRIC on first use after the meter provider is set. The OTel
 * metrics API has no proxy provider, so startTelemetry() calls resetInstruments() after it
 * registers one; before that every recorder writes to the no-op meter.
 */
export function instruments(): Instruments {
  if (cache) return cache;
  const meter = metrics.getMeter(METER_NAME);
  const counter = (spec: MetricSpec) =>
    meter.createCounter(spec.name, { unit: spec.unit, description: spec.description });
  cache = {
    runsEnded: counter(METRIC.runsEnded),
    runFailures: counter(METRIC.runFailures),
    runErrors: counter(METRIC.runErrors),
    approvalsRequested: counter(METRIC.approvalsRequested),
    approvalsResolved: counter(METRIC.approvalsResolved),
    controlChanges: counter(METRIC.controlChanges),
    slotLeases: counter(METRIC.slotLeases),
    blocksAdded: counter(METRIC.blocksAdded),
    downloads: counter(METRIC.downloads),
    downloadSize: meter.createHistogram(METRIC.downloadSize.name, {
      unit: METRIC.downloadSize.unit,
      description: METRIC.downloadSize.description,
    }),
    budgetHits: counter(METRIC.budgetHits),
    modelFallbacks: counter(METRIC.modelFallbacks),
    notesFiled: counter(METRIC.notesFiled),
    modelTokens: counter(METRIC.modelTokens),
    spendUsd: counter(METRIC.spendUsd),
    sseConnections: meter.createUpDownCounter(METRIC.sseConnections.name, {
      unit: METRIC.sseConnections.unit,
      description: METRIC.sseConnections.description,
    }),
    alertsReceived: counter(METRIC.alertsReceived),
    pushSends: counter(METRIC.pushSends),
    telemetryDropped: counter(METRIC.telemetryDropped),
    observerVerdicts: counter(METRIC.observerVerdicts),
    observerFailures: counter(METRIC.observerFailures),
    observerOverrides: counter(METRIC.observerOverrides),
    observerSpend: counter(METRIC.observerSpend),
  };
  return cache;
}

export function resetInstruments(): void {
  cache = null;
}
