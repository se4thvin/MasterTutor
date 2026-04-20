import type { RunStatus } from "@mastertutor/contracts";

/**
 * The states a status mark shows (StatusMark): one vocabulary for the run badge, the vault session
 * mark and F3's run rows. A run's finish flash is the subset that ends a run (lib/runs/pulse.ts).
 */
export const STATUS_MARK_STATUSES = ["pending", "running", "done", "failed", "cancelled"] as const;
export type StatusMarkStatus = (typeof STATUS_MARK_STATUSES)[number];

const MARK: Record<RunStatus, StatusMarkStatus> = {
  queued: "pending",
  running: "running",
  // Paused for the user or a slot: not moving, not finished.
  waiting: "pending",
  sleeping: "pending",
  completed: "done",
  failed: "failed",
  cancelled: "cancelled",
};

/** The one mapping from a run's status to its mark (runs list, run header, timeline, badge). */
export const markStatus = (status: RunStatus): StatusMarkStatus => MARK[status];
