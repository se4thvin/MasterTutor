import { COPILOT_LIMITS } from "@mastertutor/contracts";

/** Spec §7.8: checked before a question and again before every model call. */
export function capCheck(
  state: { questionsInWindow: number; spentTodayUsd: number },
  dailyUsd: number,
): { ok: true } | { ok: false; code: "rate_limited" | "daily_cap" } {
  if (state.spentTodayUsd >= dailyUsd) return { ok: false, code: "daily_cap" };
  if (state.questionsInWindow >= COPILOT_LIMITS.questionsPerWindow)
    return { ok: false, code: "rate_limited" };
  return { ok: true };
}
