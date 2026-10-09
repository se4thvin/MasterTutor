import { createLogger } from "@mastertutor/contracts/server";
import { SPAN } from "@mastertutor/contracts/telemetry";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTelemetry, startTelemetry } from "./start.ts";
import { instrument } from "./instrument.ts";
import { recordModelTokens, recordRunEvent, recordSpend } from "./record.ts";

const quantile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * q)]!;
const RUN = "11111111-1111-4111-8111-111111111111";
const log = createLogger({ service: "agent", destination: { write: () => undefined } });

beforeAll(() => {
  // The collector is down (closed port): the worst case for the export path.
  startTelemetry({
    service: "agent",
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9", MT_DEPLOYMENT: "test" },
    crash: "observe",
    log,
  });
});
afterAll(async () => {
  await getTelemetry().shutdown();
});

/** Exactly what one agent step adds (spec §15): four spans, three run events, records, two log lines. */
async function stepEnvelope(): Promise<void> {
  await instrument(SPAN.step, { "mt.run.id": RUN, "mt.step.phase": "act" }, async (step) => {
    await instrument(SPAN.modelRequest, { "mt.model.name": "gpt-6-astra" }, async (span) => {
      span.set({ "mt.model.tokens.input": 1_000, "mt.model.cost_usd": 0.01 });
      recordModelTokens("gpt-6-astra", { input: 1_000, cached: 200, output: 50 });
    });
    await instrument(SPAN.tool, { "mt.tool.name": "computer" }, async (span) => {
      span.set({ "mt.tool.outcome": "ok", "mt.action.types": ["click"] });
    });
    await instrument(SPAN.stepCommit, { "mt.run.id": RUN }, async () => {
      recordRunEvent({
        type: "step",
        seq: 1,
        phase: "act",
        state: "done",
        caption: null,
        url: null,
        screenshotKey: null,
        action: null,
      });
      recordRunEvent({ type: "status", status: "running", waitReason: null, reason: null });
      recordRunEvent({ type: "control", holder: "agent" });
      recordSpend(0.01, "run");
    });
    log.info({ seq: 1 }, "act done");
    log.debug({ seq: 1 }, "detail");
    step.set({ "mt.step.outcome": "continue" });
  });
}

describe("per-step telemetry overhead with the collector down (spec §15)", () => {
  it("stays under 2 ms at p50 and 5 ms at p99", async () => {
    for (let i = 0; i < 200; i++) await stepEnvelope();
    const samples: number[] = [];
    for (let i = 0; i < 2_000; i++) {
      const t = performance.now();
      await stepEnvelope();
      samples.push(performance.now() - t);
    }
    expect(quantile(samples, 0.5)).toBeLessThan(2);
    expect(quantile(samples, 0.99)).toBeLessThan(5);
  });
});
