import type { RunStatus } from "@mastertutor/contracts";

/** The outcome a finished run flashes on the Runs nav item. */
export type RunFlash = "done" | "failed" | "cancelled";

export const finishedIds = (before: readonly string[], now: readonly string[]): string[] =>
  before.filter((id) => !now.includes(id));

/**
 * The flash for runs that just left the running list. A failure is the one the user must not miss,
 * so it wins; a run that only paused (waiting for approval, sleeping) does not flash.
 */
export function flashStatus(statuses: readonly RunStatus[]): RunFlash | null {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("completed")) return "done";
  if (statuses.includes("cancelled")) return "cancelled";
  return null;
}
