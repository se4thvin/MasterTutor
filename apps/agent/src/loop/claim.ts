import { randomUUID } from "node:crypto";
import {
  DEFAULT_CONCURRENCY,
  type LeasePriority,
  type RunEvent,
  type RunStatus,
} from "@mastertutor/contracts";
import { runs, settings, type Database } from "@mastertutor/db";
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { emitRunEvent, emitRunEvents } from "../events/emit.ts";
import { LeaseLost } from "../runtime/errors.ts";
import type { Tx } from "../runtime/types.ts";
import {
  assignSlot,
  extendSlotLease,
  leaseUntil,
  pickIdleSlot,
  releaseSlot,
} from "../slots/leases.ts";

export type RunRecord = typeof runs.$inferSelect;

export interface ClaimOptions {
  owner: string;
  slots: readonly string[];
  leaseMs: number;
}

export interface ClaimedRun {
  run: RunRecord;
  /**
   * This claim's own lease owner (`<agent owner>:<uuid>`). Renewals and step commits check it, so a
   * stale worker of the same agent loses every write once its run is claimed again.
   */
  leaseToken: string;
  /** The slot a reclaimed run held before (now restarting): restart it at once to cut off a stale worker. */
  reclaimedSlot: string | null;
  slotName: string;
  priority: LeasePriority;
  previousStatus: RunStatus;
}

const notKilled = sql`not exists (select 1 from ${settings} where ${settings.workspaceId} = ${runs.workspaceId} and ${settings.killSwitch})`;

async function workspaceConcurrency(tx: Tx, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ concurrency: settings.concurrency })
    .from(settings)
    .where(eq(settings.workspaceId, workspaceId));
  return row?.concurrency ?? DEFAULT_CONCURRENCY;
}

/** Spec §5.2 rule 2: claim a run and lease a slot in one transaction (SKIP LOCKED on both). */
export async function claimNextRun(
  db: Database,
  options: ClaimOptions,
): Promise<ClaimedRun | null> {
  return db.transaction(async (tx) => {
    const leaseExpired = or(isNull(runs.leaseExpiresAt), lt(runs.leaseExpiresAt, sql`now()`));
    const claimable = or(
      eq(runs.status, "queued"),
      and(inArray(runs.status, ["running", "waiting"]), leaseExpired),
      and(eq(runs.status, "sleeping"), isNotNull(runs.wakeRequestedAt)),
    );
    const [candidate] = await tx
      .select()
      .from(runs)
      .where(and(claimable, notKilled))
      .orderBy(sql`(${runs.status} = 'queued')`, asc(runs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    const leaseToken = `${options.owner}:${randomUUID()}`;
    const priority: LeasePriority = candidate.status === "queued" ? "queued" : "wake";
    const concurrency = await workspaceConcurrency(tx, candidate.workspaceId);
    const slotName = await pickIdleSlot(tx, { slots: options.slots, priority, concurrency });
    if (!slotName) return null;

    if (candidate.slotName)
      await releaseSlot(tx, { name: candidate.slotName, runId: candidate.id });
    await assignSlot(tx, {
      name: slotName,
      runId: candidate.id,
      owner: leaseToken,
      leaseMs: options.leaseMs,
    });
    const [run] = await tx
      .update(runs)
      .set({
        status: sql`(case when ${runs.status} in ('queued', 'sleeping') then 'running' else ${runs.status}::text end)::run_status`,
        slotName,
        leaseOwner: leaseToken,
        leaseExpiresAt: leaseUntil(options.leaseMs),
        wakeRequestedAt: null,
        lastActivityAt: sql`now()`,
      })
      .where(eq(runs.id, candidate.id))
      .returning();
    if (!run) throw new Error("claimed run vanished");

    const events: RunEvent[] = [{ type: "slot", slotName }];
    if (run.status !== candidate.status) {
      events.push({ type: "status", status: run.status, waitReason: run.waitReason, reason: null });
    }
    await emitRunEvents(tx, run.id, events);
    return {
      run,
      leaseToken,
      reclaimedSlot: candidate.slotName ?? null,
      slotName,
      priority,
      previousStatus: candidate.status,
    };
  });
}

/** Spec §5.2 rule 4: extend both leases; losing either means the run stops without acting. */
export async function renewLeases(
  db: Database,
  options: { runId: string; slotName: string; owner: string; leaseMs: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    const renewed = await tx
      .update(runs)
      .set({ leaseExpiresAt: leaseUntil(options.leaseMs) })
      .where(and(eq(runs.id, options.runId), eq(runs.leaseOwner, options.owner)))
      .returning({ id: runs.id });
    const slot = await extendSlotLease(tx, {
      name: options.slotName,
      runId: options.runId,
      owner: options.owner,
      leaseMs: options.leaseMs,
    });
    if (renewed.length === 0 || !slot) throw new LeaseLost(options.runId);
  });
}

export async function killedWorkspaces(db: Database): Promise<string[]> {
  const rows = await db
    .select({ workspaceId: settings.workspaceId })
    .from(settings)
    .where(eq(settings.killSwitch, true));
  return rows.map((row) => row.workspaceId);
}

/** Kill switch (spec §5.5): cancels the runs no live agent owns. Owned runs are cancelled by their workers. */
export async function cancelRunsForKill(
  db: Database,
  workspaceIds: readonly string[],
): Promise<string[]> {
  if (workspaceIds.length === 0) return [];
  return db.transaction(async (tx) => {
    const cancelled = await tx
      .update(runs)
      .set({
        status: "cancelled",
        waitReason: null,
        finishedAt: sql`now()`,
        error: { code: "kill_switch", message: "Stopped by the kill switch" },
        leaseOwner: null,
        leaseExpiresAt: null,
        wakeRequestedAt: null,
      })
      .where(
        and(
          inArray(runs.workspaceId, [...workspaceIds]),
          or(
            inArray(runs.status, ["queued", "sleeping"]),
            and(
              inArray(runs.status, ["running", "waiting"]),
              or(isNull(runs.leaseExpiresAt), lt(runs.leaseExpiresAt, sql`now()`)),
            ),
          ),
        ),
      )
      .returning({ id: runs.id });
    for (const { id } of cancelled) {
      await emitRunEvent(tx, id, {
        type: "status",
        status: "cancelled",
        waitReason: null,
        reason: "kill switch",
      });
    }
    return cancelled.map((row) => row.id);
  });
}
