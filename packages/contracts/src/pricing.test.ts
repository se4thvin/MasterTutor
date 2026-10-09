import { describe, expect, it } from "vitest";
import { MODELS } from "./constants.ts";
import { MODEL_PRICES, costUsd } from "./pricing.ts";

describe("the single price table (spec §3, IM §4)", () => {
  it("prices every Responses model we call, so nothing falls back silently", () => {
    for (const model of [
      MODELS.agentPrimary,
      MODELS.agentFallback,
      MODELS.filing,
      MODELS.runTitle,
      MODELS.observerGuardScreen,
      MODELS.observerGuardReview,
      MODELS.observerCopilot,
    ])
      expect(MODEL_PRICES[model], model).toBeDefined();
  });
  it("never prices luna above astra", () => {
    expect(MODEL_PRICES[MODELS.observerGuardScreen]!.inputPerM).toBeLessThanOrEqual(
      MODEL_PRICES[MODELS.agentPrimary]!.inputPerM,
    );
  });
  it("uses the published prices (spike §10, 2026-10-09)", () => {
    expect(MODEL_PRICES[MODELS.filing]).toMatchObject({
      inputPerM: 0.1,
      cachedPerM: 0.01,
      cacheWritePerM: 0.125,
      outputPerM: 0.5,
    });
    expect(MODEL_PRICES[MODELS.agentFallback]).toMatchObject({
      inputPerM: 2,
      cachedPerM: 0.1,
      cacheWritePerM: 2.5,
      outputPerM: 10,
    });
    expect(MODEL_PRICES[MODELS.agentPrimary]!.cacheWritePerM).toBe(12.5);
  });
  it("charges cached input at the cached price", () => {
    const full = costUsd(MODELS.agentPrimary, {
      input: 1_000_000,
      cached: 0,
      cacheWrite: 0,
      output: 0,
    });
    const cached = costUsd(MODELS.agentPrimary, {
      input: 1_000_000,
      cached: 1_000_000,
      cacheWrite: 0,
      output: 0,
    });
    expect(cached).toBeLessThan(full);
  });
});
