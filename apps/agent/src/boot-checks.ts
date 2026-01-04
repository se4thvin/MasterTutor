import { getMaxConcurrency, type Database } from "@mastertutor/db";

export function concurrencyProblem(
  maxConcurrency: number | null,
  slotCount: number,
): string | null {
  if (maxConcurrency === null || maxConcurrency <= slotCount) return null;
  return `settings.concurrency (${maxConcurrency}) exceeds the number of browser slots (${slotCount}); change the Compose slots, BROWSER_SLOTS and settings.concurrency together`;
}

/** Spec §3.1 rule 4: boot fails if concurrency > slot count. */
export async function assertConcurrencyFitsSlots(db: Database, slotCount: number): Promise<void> {
  const problem = concurrencyProblem(await getMaxConcurrency(db), slotCount);
  if (problem) throw new Error(problem);
}
