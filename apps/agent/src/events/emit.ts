import { RunEvent, encodeNotify } from "@mastertutor/contracts";
import { runEvents } from "@mastertutor/db";
import { sql } from "drizzle-orm";
import type { Tx } from "../runtime/types.ts";

/**
 * Appends one RunEvent and NOTIFYs run_event {runId, eventId} (spec §6). Inside a transaction the
 * notification is delivered on commit only, so the SSE route never sees an uncommitted event.
 */
export async function emitRunEvent(tx: Tx, runId: string, event: RunEvent): Promise<string> {
  const payload = RunEvent.parse(event);
  const [row] = await tx
    .insert(runEvents)
    .values({ runId, type: payload.type, payload })
    .returning({ id: runEvents.id });
  if (!row) throw new Error("run_events insert returned no row");
  const eventId = String(row.id);
  await tx.execute(
    sql`select pg_notify('run_event', ${encodeNotify("run_event", { runId, eventId })})`,
  );
  return eventId;
}

export async function emitRunEvents(
  tx: Tx,
  runId: string,
  events: readonly RunEvent[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const event of events) ids.push(await emitRunEvent(tx, runId, event));
  return ids;
}
