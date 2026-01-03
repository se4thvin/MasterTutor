import { SlotName, type SlotState } from "@mastertutor/contracts";
import { asc, inArray } from "drizzle-orm";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import type { Database } from "../client.ts";
import { browserSlots } from "../schema/index.ts";

/** Makes browser_slots match BROWSER_SLOTS: new slots start 'restarting' until agent sees CDP. */
export async function syncBrowserSlots(
  sql: Sql | TransactionSql,
  names: readonly string[],
): Promise<void> {
  const valid = z
    .array(SlotName)
    .min(1)
    .parse([...names]);
  await sql`insert into browser_slots ${sql(valid.map((name) => ({ name })))} on conflict (name) do nothing`;
  await sql`delete from browser_slots
            where not (name = any(${sql.array(valid)})) and state <> 'leased'`;
}

export interface SlotStatus {
  name: string;
  state: SlotState;
  runId: string | null;
}

export async function listBrowserSlots(
  db: Database,
  names: readonly string[],
): Promise<SlotStatus[]> {
  if (names.length === 0) return [];
  return db
    .select({ name: browserSlots.name, state: browserSlots.state, runId: browserSlots.runId })
    .from(browserSlots)
    .where(inArray(browserSlots.name, [...names]))
    .orderBy(asc(browserSlots.name));
}
