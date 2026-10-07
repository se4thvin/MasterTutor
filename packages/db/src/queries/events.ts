import { RunEvent, encodeNotify } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import type { DbTx } from "../client.ts";
import { runEvents } from "../schema/index.ts";

/**
 * Appends one RunEvent and NOTIFYs run_event {runId, eventId} (spec §6). Inside a transaction the
 * notification is delivered on commit only, so the SSE route never sees an uncommitted event.
 * The single implementation for agent and web (principle 6).
 *
 * It first locks the run row (a no-op for callers that already hold it), so the writers of one
 * run commit their event ids in id order. The SSE cursor (`id > last`) relies on that: an earlier
 * id committing after a later one would be skipped for good.
 */
export async function emitRunEvent(tx: DbTx, runId: string, event: RunEvent): Promise<string> {
  const payload = RunEvent.parse(event);
  await tx.execute(sql`select 1 from runs where id = ${runId} for no key update`);
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
  tx: DbTx,
  runId: string,
  events: readonly RunEvent[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const event of events) ids.push(await emitRunEvent(tx, runId, event));
  return ids;
}
