import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { seedMember, startTestDatabase, type TestDatabase } from "../testing.ts";
import {
  acknowledgeAlert,
  activeAlerts,
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  isPushSubscribed,
  listAlerts,
  onlyWorkspaceId,
  ownerPushTargets,
  recordAlert,
  savePushSubscription,
} from "./alerts.ts";
import { isSignedInOwner, memberRoleOf } from "./workspace.ts";

let database: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let agent: DbHandle;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  web = createDb(database.webUrl, { max: 2 });
  agent = createDb(database.agentUrl, { max: 2 });
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close(), agent?.close()]);
  await database?.stop();
});

const target = (n: number) => ({
  endpoint: `https://web.push.apple.com/sub-${n}`,
  p256dh: `B${"A".repeat(86)}`,
  auth: "A".repeat(22),
});

describe("alerts (spec §13.3)", () => {
  it("dedupes a rule within the window and keeps rules apart", async () => {
    const { workspaceId } = await seedMember(owner.db);
    const first = await recordAlert(web.db, { workspaceId, rule: "run_failed", dedupeMinutes: 10 });
    const again = await recordAlert(web.db, { workspaceId, rule: "run_failed", dedupeMinutes: 10 });
    const other = await recordAlert(web.db, { workspaceId, rule: "spend_jump", dedupeMinutes: 10 });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    expect(other.created).toBe(true);
  });

  it("racing deliveries of one rule agree on one row", async () => {
    const { workspaceId } = await seedMember(owner.db);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        recordAlert(web.db, { workspaceId, rule: "error_spike", dedupeMinutes: 10 }),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("lists newest first with labels, pages, and acknowledges once, per workspace", async () => {
    const { workspaceId, userId } = await seedMember(owner.db);
    const a = await recordAlert(web.db, { workspaceId, rule: "error_spike", dedupeMinutes: 10 });
    const b = await recordAlert(web.db, {
      workspaceId,
      rule: "slot_crash_loop",
      dedupeMinutes: 10,
    });
    const page1 = await listAlerts(web.db, workspaceId, { limit: 1, cursor: null });
    expect(page1.items.map((i) => [i.id, i.label])).toEqual([
      [b.id, "A browser slot keeps crashing"],
    ]);
    const page2 = await listAlerts(web.db, workspaceId, { limit: 1, cursor: page1.nextCursor });
    expect(page2.items.map((i) => i.id)).toEqual([a.id]);
    expect(page2.nextCursor).toBeNull();
    expect(await acknowledgeAlert(web.db, { workspaceId, alertId: a.id, userId })).toBe(true);
    const [firstAck] = await owner.sql<
      { at: Date }[]
    >`select acknowledged_at as at from alerts where id = ${a.id}`;
    expect(await acknowledgeAlert(web.db, { workspaceId, alertId: a.id, userId })).toBe(true);
    const [secondAck] = await owner.sql<
      { at: Date }[]
    >`select acknowledged_at as at from alerts where id = ${a.id}`;
    expect(secondAck!.at).toEqual(firstAck!.at);
    expect((await activeAlerts(web.db, workspaceId)).map((i) => i.id)).toEqual([b.id]);
    const elsewhere = await seedMember(owner.db);
    expect(
      await acknowledgeAlert(web.db, { workspaceId: elsewhere.workspaceId, alertId: b.id, userId }),
    ).toBe(false);
    expect(await listAlerts(web.db, elsewhere.workspaceId, { limit: 10, cursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("sends pushes to the owner's subscriptions only", async () => {
    const own = await seedMember(owner.db, { role: "owner" });
    const member = await seedMember(owner.db, { workspaceId: own.workspaceId, role: "member" });
    await savePushSubscription(web.db, { userId: own.userId, ...target(1) });
    await savePushSubscription(web.db, { userId: own.userId, ...target(1) });
    await savePushSubscription(web.db, { userId: member.userId, ...target(2) });
    expect((await ownerPushTargets(web.db, own.workspaceId)).map((t) => t.endpoint)).toEqual([
      target(1).endpoint,
    ]);
    // Only the subscriber removes their own subscription.
    await deletePushSubscription(web.db, { userId: member.userId, endpoint: target(1).endpoint });
    expect(await ownerPushTargets(web.db, own.workspaceId)).toHaveLength(1);
    await deletePushSubscription(web.db, { userId: own.userId, endpoint: target(1).endpoint });
    expect(await ownerPushTargets(web.db, own.workspaceId)).toEqual([]);
    await savePushSubscription(web.db, { userId: own.userId, ...target(3) });
    await deletePushSubscriptionByEndpoint(web.db, target(3).endpoint);
    expect(await ownerPushTargets(web.db, own.workspaceId)).toEqual([]);
  });

  it("tells a browser whether its own subscription is still held", async () => {
    const own = await seedMember(owner.db, { role: "owner" });
    const other = await seedMember(owner.db, { workspaceId: own.workspaceId, role: "member" });
    const sub = { userId: own.userId, ...target(7) };
    expect(await isPushSubscribed(web.db, { userId: own.userId, endpoint: sub.endpoint })).toBe(
      false,
    );
    await savePushSubscription(web.db, sub);
    expect(await isPushSubscribed(web.db, { userId: own.userId, endpoint: sub.endpoint })).toBe(
      true,
    );
    expect(await isPushSubscribed(web.db, { userId: other.userId, endpoint: sub.endpoint })).toBe(
      false,
    );
    await deletePushSubscriptionByEndpoint(web.db, sub.endpoint);
    expect(await isPushSubscribed(web.db, { userId: own.userId, endpoint: sub.endpoint })).toBe(
      false,
    );
  });

  it("an owner with a live session is a signed-in owner; sign-out or a member is not", async () => {
    const own = await seedMember(owner.db, { role: "owner" });
    const member = await seedMember(owner.db, { workspaceId: own.workspaceId, role: "member" });
    const session = async (userId: string, minutes: number) =>
      owner.sql`insert into "session" (id, token, user_id, expires_at, created_at, updated_at)
        values (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${userId},
                now() + make_interval(mins => ${minutes}), now(), now())`;
    expect(await isSignedInOwner(web.db, own.userId)).toBe(false);
    await session(own.userId, -5);
    expect(await isSignedInOwner(web.db, own.userId)).toBe(false);
    await session(own.userId, 60);
    await session(member.userId, 60);
    expect(await isSignedInOwner(web.db, own.userId)).toBe(true);
    expect(await isSignedInOwner(web.db, member.userId)).toBe(false);
  });

  it("knows the member's role and the single workspace", async () => {
    const { userId, workspaceId } = await seedMember(owner.db, { role: "member" });
    expect(await memberRoleOf(web.db, userId)).toEqual({ workspaceId, role: "member" });
    expect(await memberRoleOf(web.db, "nobody")).toBeNull();
    expect(await onlyWorkspaceId(web.db)).toEqual(expect.any(String));
  });

  it("the agent role cannot read alerts or subscriptions (least privilege)", async () => {
    await expect(agent.sql`select 1 from alerts limit 1`).rejects.toThrow(/permission denied/);
    await expect(agent.sql`select 1 from push_subscriptions limit 1`).rejects.toThrow(
      /permission denied/,
    );
  });
});
