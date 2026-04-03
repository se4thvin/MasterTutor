import { encodeNotify } from "@mastertutor/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Database, DbTx } from "../client.ts";
import { runs } from "../schema/index.ts";

/**
 * The one "control goes back to the agent" write (F4): web hand back, the agent's failed-takeover
 * revert and the 15-minute idle hand-back all use it. True if the user held control.
 */
export async function returnControlToAgent(tx: DbTx, runId: string): Promise<boolean> {
  const rows = await tx
    .update(runs)
    .set({ controller: "agent", controlUserId: null })
    .where(and(eq(runs.id, runId), eq(runs.controller, "user")))
    .returning({ id: runs.id });
  return rows.length === 1;
}

/** NOTIFY run_control {runId}; delivered when the transaction commits (spec §3.1 rule 2). */
export async function notifyRunControl(tx: DbTx, runId: string): Promise<void> {
  await tx.execute(sql`select pg_notify('run_control', ${encodeNotify("run_control", { runId })})`);
}

/** The member holding control of the run, or null while the agent holds it. */
export async function readControlUser(db: Database, runId: string): Promise<string | null> {
  const [row] = await db
    .select({ controller: runs.controller, userId: runs.controlUserId })
    .from(runs)
    .where(eq(runs.id, runId));
  return row?.controller === "user" ? row.userId : null;
}
