import type { LeasePriority, SlotState } from "@mastertutor/contracts";
import { browserSlots, runs, type Database } from "@mastertutor/db";
import { and, asc, count, eq, inArray, lt, sql } from "drizzle-orm";
import type { Tx } from "../runtime/types.ts";

export const leaseUntil = (ms: number) => sql`now() + (${ms}::int * interval '1 millisecond')`;

/** Spec §5.2 rule 3: a queued run may lease only if another idle slot remains; a wake may take the last. */
export async function pickIdleSlot(
  tx: Tx,
  options: { slots: readonly string[]; priority: LeasePriority; concurrency: number },
): Promise<string | null> {
  const idle = await tx
    .select({ name: browserSlots.name })
    .from(browserSlots)
    .where(and(eq(browserSlots.state, "idle"), inArray(browserSlots.name, [...options.slots])))
    .orderBy(asc(browserSlots.name))
    .for("update", { skipLocked: true });
  if (idle.length < (options.priority === "queued" ? 2 : 1)) return null;
  const [leased] = await tx
    .select({ value: count() })
    .from(browserSlots)
    .where(eq(browserSlots.state, "leased"));
  if ((leased?.value ?? 0) >= options.concurrency) return null;
  return idle[0]?.name ?? null;
}

export async function assignSlot(
  tx: Tx,
  options: { name: string; runId: string; owner: string; leaseMs: number },
): Promise<void> {
  await tx
    .update(browserSlots)
    .set({
      state: "leased",
      runId: options.runId,
      leaseOwner: options.owner,
      leaseExpiresAt: leaseUntil(options.leaseMs),
    })
    .where(eq(browserSlots.name, options.name));
}

/** Release step 2 (spec §5.2): the slot goes to restarting; the pool restarts it after commit. */
export async function releaseSlot(tx: Tx, options: { name: string; runId: string }): Promise<void> {
  await tx
    .update(browserSlots)
    .set({
      state: "restarting",
      runId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      restartedAt: sql`now()`,
    })
    .where(and(eq(browserSlots.name, options.name), eq(browserSlots.runId, options.runId)));
  await tx.update(runs).set({ slotName: null }).where(eq(runs.id, options.runId));
}

export async function extendSlotLease(
  tx: Tx,
  options: { name: string; runId: string; owner: string; leaseMs: number },
): Promise<boolean> {
  const rows = await tx
    .update(browserSlots)
    .set({ leaseExpiresAt: leaseUntil(options.leaseMs) })
    .where(
      and(
        eq(browserSlots.name, options.name),
        eq(browserSlots.runId, options.runId),
        eq(browserSlots.leaseOwner, options.owner),
      ),
    )
    .returning({ name: browserSlots.name });
  return rows.length === 1;
}

/** Slots held by a dead agent go back to restarting; their runs lose slot_name so slots can be reused. */
export async function reclaimExpiredSlots(
  db: Database,
  slots: readonly string[],
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const reclaimed = await tx
      .update(browserSlots)
      .set({ state: "restarting", runId: null, leaseOwner: null, leaseExpiresAt: null })
      .where(
        and(
          eq(browserSlots.state, "leased"),
          lt(browserSlots.leaseExpiresAt, sql`now()`),
          inArray(browserSlots.name, [...slots]),
        ),
      )
      .returning({ name: browserSlots.name });
    const names = reclaimed.map((row) => row.name);
    if (names.length > 0) {
      await tx.update(runs).set({ slotName: null }).where(inArray(runs.slotName, names));
    }
    return names;
  });
}

export async function markSlotIdle(db: Database, name: string): Promise<boolean> {
  const rows = await db
    .update(browserSlots)
    .set({ state: "idle", restartedAt: sql`now()` })
    .where(and(eq(browserSlots.name, name), eq(browserSlots.state, "restarting")))
    .returning({ name: browserSlots.name });
  return rows.length === 1;
}

export async function listSlotsInState(
  db: Database,
  slots: readonly string[],
  state: SlotState,
): Promise<string[]> {
  const rows = await db
    .select({ name: browserSlots.name })
    .from(browserSlots)
    .where(and(eq(browserSlots.state, state), inArray(browserSlots.name, [...slots])))
    .orderBy(asc(browserSlots.name));
  return rows.map((row) => row.name);
}
