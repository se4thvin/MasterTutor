import { ALERT_LABELS, type AlertRule, type AlertView } from "@mastertutor/contracts";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { alerts, pushSubscriptions, workspaceMembers, workspaces } from "../schema/index.ts";
import { keysetBefore, keysetCursor, msOf, parseKeysetCursor } from "./keyset.ts";

/** Where one push goes: a browser's endpoint and its RFC 8291 keys. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

type AlertRow = typeof alerts.$inferSelect;
const view = (row: AlertRow): AlertView => ({
  id: row.id,
  rule: row.rule,
  label: ALERT_LABELS[row.rule],
  firedAt: row.firedAt.toISOString(),
  acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
});

/** v1 has one workspace (D4): where an alert from OpenObserve belongs. */
export async function onlyWorkspaceId(db: Database): Promise<string | null> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** One row per rule per window (spec §13.2): racing deliveries agree under an advisory lock. */
export async function recordAlert(
  db: Database,
  input: { workspaceId: string; rule: AlertRule; dedupeMinutes: number },
): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`mt.alert:${input.workspaceId}:${input.rule}`}))`,
    );
    const [recent] = await tx
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.workspaceId, input.workspaceId),
          eq(alerts.rule, input.rule),
          gt(alerts.firedAt, sql`now() - make_interval(mins => ${input.dedupeMinutes})`),
        ),
      )
      .orderBy(desc(alerts.firedAt))
      .limit(1);
    if (recent) return { id: recent.id, created: false };
    const [created] = await tx
      .insert(alerts)
      .values({ workspaceId: input.workspaceId, rule: input.rule })
      .returning({ id: alerts.id });
    if (!created) throw new Error("alerts insert returned no row");
    return { id: created.id, created: true };
  });
}

/** Newest first, keyset-paged (throws KeysetCursorInvalid on a forged cursor). */
export async function listAlerts(
  db: Database,
  workspaceId: string,
  page: { limit: number; cursor: string | null },
): Promise<{ items: AlertView[]; nextCursor: string | null }> {
  const position = parseKeysetCursor(page.cursor);
  const rows = await db
    .select()
    .from(alerts)
    .where(
      and(eq(alerts.workspaceId, workspaceId), keysetBefore(alerts.firedAt, alerts.id, position)),
    )
    .orderBy(desc(msOf(alerts.firedAt)), desc(alerts.id))
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items: items.map(view),
    nextCursor: rows.length > page.limit && last ? keysetCursor(last.firedAt, last.id) : null,
  };
}

/** Unacknowledged alerts, newest first: what the banner shows. */
export async function activeAlerts(
  db: Database,
  workspaceId: string,
  limit = 5,
): Promise<AlertView[]> {
  const rows = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.workspaceId, workspaceId), isNull(alerts.acknowledgedAt)))
    .orderBy(desc(alerts.firedAt))
    .limit(limit);
  return rows.map(view);
}

/** Idempotent: an acknowledged alert keeps its first acknowledgement. False when not found. */
export async function acknowledgeAlert(
  db: Database,
  input: { workspaceId: string; alertId: string; userId: string },
): Promise<boolean> {
  const rows = await db
    .update(alerts)
    .set({
      acknowledgedAt: sql`coalesce(${alerts.acknowledgedAt}, now())`,
      acknowledgedBy: sql`coalesce(${alerts.acknowledgedBy}, ${input.userId})`,
    })
    .where(and(eq(alerts.id, input.alertId), eq(alerts.workspaceId, input.workspaceId)))
    .returning({ id: alerts.id });
  return rows.length > 0;
}

/** A re-subscribed browser keeps one row per endpoint (the newest user and keys win). */
export async function savePushSubscription(
  db: Database,
  input: { userId: string } & PushTarget,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values(input)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: input.userId, p256dh: input.p256dh, auth: input.auth },
    });
}

/** The subscriber turns phone alerts off: only their own row goes. */
export async function deletePushSubscription(
  db: Database,
  input: { userId: string; endpoint: string },
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, input.userId),
        eq(pushSubscriptions.endpoint, input.endpoint),
      ),
    );
}

/** A push service answered 404/410: the subscription is gone for good. */
export async function deletePushSubscriptionByEndpoint(
  db: Database,
  endpoint: string,
): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/** The workspace owner's subscriptions: the only ones alerts are pushed to (D50). */
export async function ownerPushTargets(db: Database, workspaceId: string): Promise<PushTarget[]> {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, pushSubscriptions.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner")));
}
