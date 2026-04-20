import type { RunStatus } from "@mastertutor/contracts";
import { markStatus, type StatusMarkStatus } from "../status.ts";

/** The outcome a finished run flashes on the Runs nav item: a mark state that ends a run. */
export type RunFlash = Exclude<StatusMarkStatus, "pending" | "running">;

export const finishedIds = (before: readonly string[], now: readonly string[]): string[] =>
  before.filter((id) => !now.includes(id));

/**
 * The flash for runs that just left the running list. A failure is the one the user must not miss,
 * so it wins; a run that only paused (waiting for approval, sleeping) does not flash.
 */
export function flashStatus(statuses: readonly RunStatus[]): RunFlash | null {
  const marks = statuses.map(markStatus);
  for (const flash of ["failed", "done", "cancelled"] as const) {
    if (marks.includes(flash)) return flash;
  }
  return null;
}
