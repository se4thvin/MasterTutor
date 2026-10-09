import { describe, expect, it } from "vitest";
import { triggersFor } from "./triggers.ts";

describe("trigger check budget (spec §12)", () => {
  it("costs well under 1 ms per item at p50", () => {
    const facts = {
      risky: false,
      actionClass: "type",
      provenance: "novel",
      pageOrigin: "https://b.test",
      allowedOrigins: Array.from({ length: 10 }, (_, i) => `https://o${i}.test`),
      firstActuationHere: true,
      injectionWindow: false,
      riskLevel: "normal",
    } as const;
    const times: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      const start = performance.now();
      triggersFor(facts);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[5_000]!).toBeLessThan(1);
  });
});
