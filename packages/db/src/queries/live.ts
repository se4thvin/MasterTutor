import {
  TERMINAL_RUN_STATUSES,
  WAITS_KEPT_THROUGH_TAKEOVER,
  encodeNotify,
  type Controller,
  type MemberRole,
  type RunStatus,
  type WaitReason,
} from "@mastertutor/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Database, DbTx } from "../client.ts";
import { browserSlots, runs, workspaceMembers } from "../schema/index.ts";
import { notifyRunControl, returnControlToAgent } from "./control.ts";
import { emitRunEvent } from "./events.ts";

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);

export interface MemberRun {
  id: string;
  workspaceId: string;
  status: RunStatus;
  controller: Controller;
  slotName: string | null;
  slotLeased: boolean;
}

const memberOf = (userId: string) =>
  and(eq(workspaceMembers.workspaceId, runs.workspaceId), eq(workspaceMembers.userId, userId));

/** The run if userId is a member of its workspace; slotLeased means browser_slots agrees. */
export async function getRunForMember(
  db: Database,
  runId: string,
  userId: string,
): Promise<MemberRun | null> {
  const [row] = await db
    .select({
      id: runs.id,
      workspaceId: runs.workspaceId,
      status: runs.status,
      controller: runs.controller,
      slotName: runs.slotName,
      slotLeased: sql<boolean>`coalesce(${browserSlots.state} = 'leased' and ${browserSlots.runId} = ${runs.id}, false)`,
    })
    .from(runs)
    .innerJoin(workspaceMembers, memberOf(userId))
    .leftJoin(browserSlots, eq(browserSlots.name, runs.slotName))
    .where(eq(runs.id, runId));
  return row ?? null;
}

/** ForwardAuth's DB check (spec §10.2): slot leased to exactly this run, and the user is a member. */
export async function canAccessLiveSlot(
  db: Database,
  query: { runId: string; slotName: string; userId: string },
): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(browserSlots)
    .innerJoin(runs, and(eq(runs.id, browserSlots.runId), eq(runs.slotName, browserSlots.name)))
    .innerJoin(workspaceMembers, memberOf(query.userId))
    .where(
      and(
        eq(browserSlots.name, query.slotName),
        eq(browserSlots.runId, query.runId),
        eq(browserSlots.state, "leased"),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

export type ControlRequestResult =
  | { ok: true; via: "control" | "wake" | "none" }
  | { ok: false; reason: "not_found" | "finished" | "not_controller" };

interface LockedRun {
  status: RunStatus;
  waitReason: WaitReason | null;
  controller: Controller;
  controlUserId: string | null;
  /** The requesting member's role in the run's workspace. */
  role: MemberRole;
}

async function lockMemberRun(tx: DbTx, runId: string, userId: string): Promise<LockedRun | null> {
  const [row] = await tx
    .select({
      status: runs.status,
      waitReason: runs.waitReason,
      controller: runs.controller,
      controlUserId: runs.controlUserId,
      role: workspaceMembers.role,
    })
    .from(runs)
    .innerJoin(workspaceMembers, memberOf(userId))
    .where(eq(runs.id, runId))
    .for("update", { of: runs });
  return row ?? null;
}

/**
 * Spec §10.3 takeover, in one transaction. A run holding (or about to hold) a slot moves to
 * waiting(takeover) and NOTIFYs run_control; a sleeping or queued run is woken with reason takeover.
 * Idempotent for the member who already holds control; another member cannot take a held run.
 */
export async function requestTakeover(
  db: Database,
  input: { runId: string; userId: string },
): Promise<ControlRequestResult> {
  return db.transaction(async (tx): Promise<ControlRequestResult> => {
    const run = await lockMemberRun(tx, input.runId, input.userId);
    if (!run) return { ok: false, reason: "not_found" };
    if (TERMINAL.has(run.status)) return { ok: false, reason: "finished" };
    // B3 E.8 note 3: a double click must not re-NOTIFY, and nobody steals a held takeover.
    if (run.controller === "user")
      return run.controlUserId === input.userId
        ? { ok: true, via: "none" }
        : { ok: false, reason: "not_controller" };
    if (run.status === "sleeping" || run.status === "queued") {
      await tx
        .update(runs)
        .set({
          controller: "user",
          controlUserId: input.userId,
          ...(run.status === "sleeping" ? { wakeRequestedAt: sql`now()` } : {}),
        })
        .where(eq(runs.id, input.runId));
      await tx.execute(
        sql`select pg_notify('run_wake', ${encodeNotify("run_wake", { runId: input.runId, reason: "takeover" })})`,
      );
      return { ok: true, via: "wake" };
    }
    // A code or CAPTCHA wait stays on the row (B3 M7): only control changes hands, and hand-back
    // re-observes whether the page still asks for it.
    const keepWait =
      run.status === "waiting" &&
      run.waitReason !== null &&
      WAITS_KEPT_THROUGH_TAKEOVER.includes(run.waitReason);
    await tx
      .update(runs)
      .set({
        controller: "user",
        controlUserId: input.userId,
        ...(keepWait ? {} : { status: "waiting" as const, waitReason: "takeover" as const }),
        lastActivityAt: sql`now()`,
      })
      .where(eq(runs.id, input.runId));
    await notifyRunControl(tx, input.runId);
    return { ok: true, via: "control" };
  });
}

/**
 * Spec §10.3 hand back: controller='agent' (the shared F4 write), the optional note as a
 * user_message, and NOTIFY run_control. While a member holds control, only that member or a
 * workspace owner may hand back (B3 E.8 note 3). A note sent after the agent already took control
 * back (idle hand-back) is still delivered.
 */
export async function requestHandBack(
  db: Database,
  input: { runId: string; userId: string; note: string | null },
): Promise<ControlRequestResult> {
  return db.transaction(async (tx): Promise<ControlRequestResult> => {
    const run = await lockMemberRun(tx, input.runId, input.userId);
    if (!run) return { ok: false, reason: "not_found" };
    if (TERMINAL.has(run.status)) return { ok: false, reason: "finished" };
    if (run.controller === "user" && run.controlUserId !== input.userId && run.role !== "owner")
      return { ok: false, reason: "not_controller" };
    const changed = run.controller === "user" && (await returnControlToAgent(tx, input.runId));
    if (input.note) await emitRunEvent(tx, input.runId, { type: "user_message", text: input.note });
    if (changed || input.note) await notifyRunControl(tx, input.runId);
    return { ok: true, via: changed ? "control" : "none" };
  });
}
