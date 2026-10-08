import { type DbLike, objectDeletions } from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
import { asc, eq } from "drizzle-orm";
import type { Log } from "../runtime/types.ts";

/** Objects deleted per sweep: bounded, so one sweep never holds the supervisor for long. */
const SWEEP_BATCH = 100;

/**
 * Deletes the objects of deleted notes (object_deletions, written by web's note delete) and drops
 * each row only after its object is gone; a failed delete stays queued for the next sweep. web's
 * storage key is read-only (spec §3.1), so the agent does this. Returns how many were deleted.
 */
export async function sweepObjectDeletions(
  db: DbLike,
  storage: Pick<Storage, "delete">,
  log: Log,
): Promise<number> {
  const pending = await db
    .select({ key: objectDeletions.key })
    .from(objectDeletions)
    .orderBy(asc(objectDeletions.createdAt))
    .limit(SWEEP_BATCH);
  let deleted = 0;
  for (const { key } of pending) {
    try {
      await storage.delete(key);
    } catch (error) {
      log.warn({ errName: (error as Error).name }, "object delete failed; retried next sweep");
      continue;
    }
    await db.delete(objectDeletions).where(eq(objectDeletions.key, key));
    deleted++;
  }
  return deleted;
}
