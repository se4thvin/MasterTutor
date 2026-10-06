import { describe, expect, it } from "vitest";
import { Budget, DEFAULT_BUDGET, EMPTY_USAGE, Plan, Usage } from "./budget.ts";

describe("budget", () => {
  it("has the spec defaults", () => {
    expect(Budget.parse(DEFAULT_BUDGET)).toEqual({
      maxSteps: 150,
      maxUsd: 5,
      maxActiveMinutes: 60,
    });
    expect(Usage.parse(EMPTY_USAGE).steps).toBe(0);
  });
  it("rejects nonsense limits", () => {
    expect(Budget.safeParse({ ...DEFAULT_BUDGET, maxSteps: 0 }).success).toBe(false);
    expect(Budget.safeParse({ ...DEFAULT_BUDGET, maxUsd: -1 }).success).toBe(false);
  });
  it("caps plan length", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ text: `step ${i}`, done: false }));
    expect(Plan.safeParse({ items }).success).toBe(false);
  });
});
