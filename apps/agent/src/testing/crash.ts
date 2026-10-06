import type { DbHandle } from "@mastertutor/db";
import type { Supervisor } from "../loop/supervisor.ts";

/**
 * Tests only: the agent process dies. Its database connection goes first, so nothing more is
 * written (no abort rows, no releases); then its workers stop. Leases expire and another agent
 * reclaims the runs, exactly as after a real crash.
 */
export async function crashSupervisor(supervisor: Supervisor, db: DbHandle): Promise<void> {
  await db.close();
  await supervisor.stop();
}
