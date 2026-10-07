import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/** A page cursor that is not exactly what a previous page returned. */
export class KeysetCursorInvalid extends Error {
  constructor() {
    super("Invalid page cursor");
    this.name = "KeysetCursorInvalid";
  }
}

export interface KeysetPosition {
  at: string;
  id: string;
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([0-9a-f-]{36})$/;

/** `<ISO instant to the ms>|<uuid>`, exactly as keysetCursor wrote it; anything else is refused. */
export function parseKeysetCursor(cursor: string | null): KeysetPosition | null {
  if (cursor === null) return null;
  const match = CURSOR.exec(cursor);
  const at = match?.[1];
  const id = match?.[2];
  if (!at || !id || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)
    throw new KeysetCursorInvalid();
  return { at, id };
}

export function keysetCursor(at: Date, id: string): string {
  return `${at.toISOString()}|${id}`;
}

/** Postgres keeps microseconds and JS milliseconds: order and compare on the millisecond. */
export function msOf(column: AnyColumn): SQL {
  return sql`date_trunc('milliseconds', ${column})`;
}

/** Rows after `position` in (at desc, id desc) order; undefined (no filter) on the first page. */
export function keysetBefore(
  at: AnyColumn,
  id: AnyColumn,
  position: KeysetPosition | null,
): SQL | undefined {
  return position
    ? sql`(${msOf(at)}, ${id}) < (${position.at}::timestamptz, ${position.id}::uuid)`
    : undefined;
}
