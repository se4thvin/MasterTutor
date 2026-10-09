import { createDb, ownerPushTargets, recordAlert, type DbHandle } from "@mastertutor/db";
import { seedMember, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAlertProcedures } from "./alerts.ts";

let database: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let ownerId: string;
let memberId: string;
let workspaceId: string;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  web = createDb(database.webUrl, { max: 2 });
  ({ userId: ownerId, workspaceId } = await seedMember(owner.db, { role: "owner" }));
  ({ userId: memberId } = await seedMember(owner.db, { workspaceId, role: "member" }));
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close()]);
  await database?.stop();
});

const PUBLIC_KEY = `B${"A".repeat(86)}`;
const as = (id: string | null, available = true) => {
  const alerts = createAlertProcedures({
    db: () => web,
    push: () => ({ available, publicKey: available ? PUBLIC_KEY : null }),
  });
  const viewer = id ? { id, name: "T", email: "t@example.test" } : null;
  return createRouterClient({ alerts }, { context: { viewer, resHeaders: new Headers() } });
};
const subscription = {
  endpoint: "https://web.push.apple.com/abc",
  keys: { p256dh: PUBLIC_KEY, auth: "A".repeat(22) },
};

describe("alerts.* (spec §13.3, Review Focus 4)", () => {
  it("lets the owner list, acknowledge and subscribe", async () => {
    const alert = await recordAlert(web.db, { workspaceId, rule: "run_failed", dedupeMinutes: 10 });
    const client = as(ownerId);
    expect((await client.alerts.active({})).items.map((a) => a.id)).toContain(alert.id);
    expect(await client.alerts.acknowledge({ id: alert.id })).toEqual({ ok: true });
    expect((await client.alerts.active({})).items.map((a) => a.id)).not.toContain(alert.id);
    const listed = await client.alerts.list({ limit: 10, cursor: null });
    expect(listed.items[0]).toMatchObject({ id: alert.id, label: "A run failed" });
    expect(listed.items[0]!.acknowledgedAt).not.toBeNull();
    expect(await client.alerts.pushConfig({})).toEqual({ available: true, publicKey: PUBLIC_KEY });
    expect(await client.alerts.pushStatus({ endpoint: subscription.endpoint })).toEqual({
      registered: false,
    });
    expect(await client.alerts.subscribe(subscription)).toEqual({ ok: true });
    expect(await client.alerts.pushStatus({ endpoint: subscription.endpoint })).toEqual({
      registered: true,
    });
    expect((await ownerPushTargets(web.db, workspaceId)).map((t) => t.endpoint)).toEqual([
      subscription.endpoint,
    ]);
    expect(await client.alerts.unsubscribe({ endpoint: subscription.endpoint })).toEqual({
      ok: true,
    });
    expect(await ownerPushTargets(web.db, workspaceId)).toEqual([]);
  });

  it("answers NOT_FOUND for an unknown alert and BAD_REQUEST for a forged cursor", async () => {
    const client = as(ownerId);
    await expect(
      client.alerts.acknowledge({ id: "11111111-1111-4111-8111-111111111111" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client.alerts.list({ limit: 10, cursor: "nope" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("is FORBIDDEN to a member and UNAUTHORIZED when signed out, for every procedure", async () => {
    for (const [client, code] of [
      [as(memberId), "FORBIDDEN"],
      [as("nobody"), "FORBIDDEN"],
      [as(null), "UNAUTHORIZED"],
    ] as const) {
      for (const call of [
        () => client.alerts.list({ limit: 10, cursor: null }),
        () => client.alerts.active({}),
        () => client.alerts.acknowledge({ id: "11111111-1111-4111-8111-111111111111" }),
        () => client.alerts.pushConfig({}),
        () => client.alerts.subscribe(subscription),
        () => client.alerts.unsubscribe({ endpoint: subscription.endpoint }),
        () => client.alerts.pushStatus({ endpoint: subscription.endpoint }),
      ])
        await expect(call()).rejects.toMatchObject({ code });
    }
  });

  it("refuses to subscribe when push is unavailable, and a non-push endpoint always", async () => {
    await expect(as(ownerId, false).alerts.subscribe(subscription)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      as(ownerId).alerts.subscribe({ ...subscription, endpoint: "https://169.254.169.254/x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await ownerPushTargets(web.db, workspaceId)).toEqual([]);
  });
});
