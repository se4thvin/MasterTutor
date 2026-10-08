import { noteBlocks } from "@mastertutor/db";
import { sql } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";

/** n fractional keys strictly between `before` and `after` (null = open end). */
export function keysBetween(before: string | null, after: string | null, n: number): string[] {
  return n === 0 ? [] : generateNKeysBetween(before, after, n);
}

/** Fractional keys are base62 in ASCII order; Postgres must compare them bytewise. */
export const positionOrder = sql`${noteBlocks.position} collate "C"`;
