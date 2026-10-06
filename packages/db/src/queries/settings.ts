import { max } from "drizzle-orm";
import type { Database } from "../client.ts";
import { settings } from "../schema/index.ts";

/** Highest settings.concurrency across workspaces; null when no workspace exists yet. */
export async function getMaxConcurrency(db: Database): Promise<number | null> {
  const [row] = await db.select({ value: max(settings.concurrency) }).from(settings);
  return row?.value ?? null;
}
