import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DbHandle } from "./client.ts";
import { capturePreferences, runs } from "./schema/index.ts";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "./testing.ts";
let testDb: TestDatabase;
let h: DbHandle;
beforeAll(async () => {
  testDb = await startTestDatabase();
  h = createDb(testDb.ownerUrl);
});
afterAll(async () => {
  await h?.close();
  await testDb?.stop();
});
it("0019 stores intent and isolates site defaults by workspace", async () => {
  const a = await seedMember(h.db),
    b = await seedMember(h.db);
  const runId = await seedRun(h.db, a);
  const brief = {
    keep: ["reading_text"] as const,
    skip: ["due_dates"] as const,
    scopeNote: "Notes only",
  };
  const value = { ...brief, keep: [...brief.keep], skip: [...brief.skip] };
  await h.db.update(runs).set({ captureBrief: value }).where(eq(runs.id, runId));
  expect((await h.db.select().from(runs).where(eq(runs.id, runId)))[0]?.captureBrief).toEqual(
    value,
  );
  for (const member of [a, a, b])
    await h.db
      .insert(capturePreferences)
      .values({ workspaceId: member.workspaceId, domain: "example.com", brief: value })
      .onConflictDoUpdate({
        target: [capturePreferences.workspaceId, capturePreferences.domain],
        set: { brief: value },
      });
  expect(
    await h.db
      .select()
      .from(capturePreferences)
      .where(eq(capturePreferences.workspaceId, a.workspaceId)),
  ).toHaveLength(1);
});

it("0020 allows the worker to remember person-confirmed scope but never delete site defaults", async () => {
  const member = await seedMember(h.db);
  const runId = await seedRun(h.db, member);
  const at = new Date();
  await h.db.update(runs).set({ captureConfirmedAt: at }).where(eq(runs.id, runId));
  expect(
    (await h.db.select().from(runs).where(eq(runs.id, runId)))[0]?.captureConfirmedAt?.getTime(),
  ).toBe(at.getTime());
  const agent = createDb(testDb.agentUrl);
  try {
    await agent.db
      .insert(capturePreferences)
      .values({
        workspaceId: member.workspaceId,
        domain: "example.edu",
        brief: { keep: ["reading_text"], skip: ["due_dates"], scopeNote: "Person's scope" },
      });
    await expect(
      agent.db
        .delete(capturePreferences)
        .where(eq(capturePreferences.workspaceId, member.workspaceId)),
    ).rejects.toThrow();
  } finally {
    await agent.close();
  }
});
