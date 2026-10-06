import type { Budget, Usage } from "@mastertutor/contracts";

/** Spec §5.5: a hit becomes a `budget` approval (Extend +50% / Finish now / Cancel), never a failure. */
export function budgetExceeded(usage: Usage, budget: Budget): "steps" | "usd" | "minutes" | null {
  if (usage.steps >= budget.maxSteps) return "steps";
  if (usage.usd >= budget.maxUsd) return "usd";
  if (usage.activeMs >= budget.maxActiveMinutes * 60_000) return "minutes";
  return null;
}

export function extendBudget(budget: Budget): Budget {
  return {
    maxSteps: Math.min(10_000, Math.ceil(budget.maxSteps * 1.5)),
    maxUsd: Math.min(1_000, Math.round(budget.maxUsd * 1.5 * 100) / 100),
    maxActiveMinutes: Math.min(24 * 60, Math.ceil(budget.maxActiveMinutes * 1.5)),
  };
}
