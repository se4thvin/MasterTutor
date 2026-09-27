import { RunEvent, encodeNotify } from "@mastertutor/contracts";
import { recordRunEvent } from "@mastertutor/telemetry/record";
import { sql } from "drizzle-orm";
import type { DbTx } from "../client.ts";
import { runEvents } from "../schema/index.ts";

/**
 * Locks the run row for the rest of the transaction (a no-op if the caller already holds it). Lock
 * order everywhere: the run row first, then rows that belong to the run (approvals, downloads).
 */
export async function lockRunRow(tx: DbTx, runId: string): Promise<void> {
  await tx.execute(sql`select 1 from runs where id = ${runId} for no key update`);
}

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
  await lockRunRow(tx, runId);
  const [row] = await tx
    .insert(runEvents)
    .values({ runId, type: payload.type, payload })
    .returning({ id: runEvents.id });
  if (!row) throw new Error("run_events insert returned no row");
  const eventId = String(row.id);
  await tx.execute(
    sql`select pg_notify('run_event', ${encodeNotify("run_event", { runId, eventId })})`,
  );
  // Seam 6 (spec §7.3): every domain event, agent and web, counted once (never its text fields).
  recordRunEvent(payload);
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
