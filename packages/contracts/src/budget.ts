import { z } from "zod";

export const Budget = z.object({
  maxSteps: z.number().int().min(1).max(10_000),
  maxUsd: z.number().positive().max(1_000),
  maxActiveMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
});
export type Budget = z.infer<typeof Budget>;
export const DEFAULT_BUDGET: Budget = { maxSteps: 150, maxUsd: 5, maxActiveMinutes: 60 };

const Count = z.number().int().nonnegative();
export const Usage = z.object({
  steps: Count,
  inputTokens: Count,
  cachedInputTokens: Count,
  outputTokens: Count,
  usd: z.number().nonnegative(),
  activeMs: Count,
});
export type Usage = z.infer<typeof Usage>;
export const EMPTY_USAGE: Usage = {
  steps: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  usd: 0,
  activeMs: 0,
};

export const PlanItem = z.object({ text: z.string().min(1).max(500), done: z.boolean() });
export type PlanItem = z.infer<typeof PlanItem>;
export const Plan = z.object({ items: z.array(PlanItem).max(50) });
export type Plan = z.infer<typeof Plan>;
