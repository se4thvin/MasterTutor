import { DEFAULT_BUDGET, EMPTY_USAGE } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { budgetExceeded, extendBudget } from "./budget.ts";

describe("budgets", () => {
  it("reports the first exceeded limit and never fails on its own", () => {
    expect(budgetExceeded(EMPTY_USAGE, DEFAULT_BUDGET)).toBeNull();
    expect(budgetExceeded({ ...EMPTY_USAGE, steps: 150 }, DEFAULT_BUDGET)).toBe("steps");
    expect(budgetExceeded({ ...EMPTY_USAGE, usd: 5 }, DEFAULT_BUDGET)).toBe("usd");
    expect(budgetExceeded({ ...EMPTY_USAGE, activeMs: 60 * 60_000 }, DEFAULT_BUDGET)).toBe(
      "minutes",
    );
  });
  it("extends every limit by 50%", () => {
    expect(extendBudget(DEFAULT_BUDGET)).toEqual({
      maxSteps: 225,
      maxUsd: 7.5,
      maxActiveMinutes: 90,
    });
    expect(extendBudget({ maxSteps: 1, maxUsd: 1, maxActiveMinutes: 1 })).toEqual({
      maxSteps: 2,
      maxUsd: 1.5,
      maxActiveMinutes: 2,
    });
  });
});
