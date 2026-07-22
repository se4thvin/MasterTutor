/** Deterministic v4-shaped UUIDs: group digit + counter, e.g. folder 1 → 00000000-0000-4000-8000-000001000001. */
const make = (group: number) => (n: number) =>
  `00000000-0000-4000-8000-${(group * 1_000_000 + n).toString().padStart(12, "0")}`;

export const ids = {
  folder: make(1),
  note: make(2),
  block: make(3),
  source: make(4),
  asset: make(5),
  vault: make(6),
  audit: make(7),
  run: make(8),
  approval: make(9),
} as const;
