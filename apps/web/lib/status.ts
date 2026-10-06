/**
 * The states a status mark shows (StatusMark): one vocabulary for the run badge, the vault session
 * mark and F3's run rows. A run's finish flash is the subset that ends a run (lib/runs/pulse.ts).
 */
export const STATUS_MARK_STATUSES = ["pending", "running", "done", "failed", "cancelled"] as const;
export type StatusMarkStatus = (typeof STATUS_MARK_STATUSES)[number];
