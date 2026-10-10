import { MODELS, costUsd } from "@mastertutor/contracts";
import { ToolError, type StepWriter } from "../tools/types.ts";

/** Conservative token ceiling before bounded auxiliary calls, just as OCR checks its tile budget. */
export function requireCaptureBudget(step: StepWriter, chars: number, output: number): void {
  const ceiling = costUsd(MODELS.filing, {
    input: chars * 4 + 1000,
    cached: 0,
    cacheWrite: 0,
    output,
  });
  if (step.usdLeft() < ceiling)
    throw new ToolError(
      "capture_budget",
      "The remaining budget cannot cover capture selection. Extend the budget to continue.",
    );
}
