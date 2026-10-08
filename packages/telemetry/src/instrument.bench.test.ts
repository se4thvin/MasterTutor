import { SPAN } from "@mastertutor/contracts/telemetry";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instrument } from "./instrument.ts";
import { installTestTelemetry, type TestTelemetry } from "./testing.ts";

const p50 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
let telemetry: TestTelemetry;
beforeAll(() => {
  telemetry = installTestTelemetry();
});
afterAll(async () => {
  await telemetry.shutdown();
});

describe("instrument() micro budget (spec §15)", () => {
  it("adds under 50 µs at p50 per span", async () => {
    const work = async () => 1;
    const bare: number[] = [];
    const wrapped: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      let t = performance.now();
      await work();
      bare.push(performance.now() - t);
      t = performance.now();
      await instrument(SPAN.tool, { "mt.tool.name": "read_page" }, work);
      wrapped.push(performance.now() - t);
    }
    expect(p50(wrapped) - p50(bare)).toBeLessThan(0.05);
  });
});
