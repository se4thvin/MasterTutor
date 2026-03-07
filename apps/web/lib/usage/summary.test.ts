import { describe, expect, it } from "vitest";
import { formatUsd, niceCeiling, rangeFor, summarize } from "./summary.ts";

describe("usage summary", () => {
  it("builds inclusive UTC ranges", () => {
    expect(rangeFor(7, new Date("2026-10-05T23:30:00Z"))).toEqual({
      from: "2026-09-29",
      to: "2026-10-05",
    });
  });
  it("totals a report", () => {
    expect(
      summarize({
        perDay: [
          { day: "a", runs: 2, usd: 1.25, steps: 30 },
          { day: "b", runs: 1, usd: 0.5, steps: 10 },
        ],
        perRun: [],
        stepLatencyMs: { p50: null, p95: null },
        openaiErrorRate: null,
      }),
    ).toEqual({ usd: 1.75, runs: 3, steps: 40 });
  });
  it("picks readable axis ceilings", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(3.2)).toBe(5);
    expect(niceCeiling(17)).toBe(20);
    expect(niceCeiling(240)).toBe(250);
  });
  it("formats money", () => {
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});
