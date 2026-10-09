import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { seedMember, startTestDatabase, type TestDatabase } from "../testing.ts";
import {
  reserveCopilotSpend,
  settleCopilotSpend,
  addSpend,
  appendItems,
  countQuestionsSince,
  createThread,
  deleteThread,
  listThreads,
  loadItems,
  loadResult,
  loadThread,
  purgeThreadsBefore,
  saveResult,
  spentToday,
} from "./copilot.ts";

let database: TestDatabase;
let owner: DbHandle;
let observer: DbHandle;
let workspaceId: string;
let userId: string;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  observer = createDb(database.observerUrl, { max: 2 });
  ({ workspaceId, userId } = await seedMember(owner.db));
}, 300_000);
afterAll(async () => {
  await observer?.close();
  await owner?.close();
  await database?.stop();
});

describe("Copilot replay storage (spec §7.3, §7.6)", () => {
  it("stores a thread's items in order and its results, scoped to the workspace", async () => {
    const id = await createThread(observer.db, { workspaceId, createdBy: userId, title: "Why?" });
    await appendItems(observer.db, id, [
      { role: "user", item: { role: "user", content: "Why?" } },
      {
        role: "tool",
        item: { type: "function_call", call_id: "c1", name: "runs_find", arguments: "{}" },
      },
    ]);
    await appendItems(observer.db, id, [
      { role: "assistant", item: { role: "assistant", content: "Because [Q1]" } },
    ]);
    expect((await loadItems(observer.db, id)).map((item) => item.seq)).toEqual([0, 1, 2]);
    await saveResult(observer.db, id, {
      resultId: "Q1",
      tool: "runs_find",
      summary: "runs",
      query: { status: "failed" },
      columns: ["run"],
      rows: [["R1"]],
      rowCount: 1,
      truncated: false,
      tookMs: 3,
      tainted: false,
    });
    expect((await loadResult(observer.db, id, "Q1"))?.rows).toEqual([["R1"]]);
    expect(await loadThread(observer.db, "00000000-0000-4000-8000-000000000000", id)).toBeNull();
    expect((await listThreads(observer.db, workspaceId)).map((t) => t.id)).toContain(id);
    expect(await countQuestionsSince(observer.db, workspaceId, new Date(Date.now() - 60_000))).toBe(
      1,
    );
    await deleteThread(observer.db, workspaceId, id);
    expect(await loadThread(observer.db, workspaceId, id)).toBeNull();
  });

  it("adds spend per UTC day and purges old threads", async () => {
    const before = await spentToday(observer.db);
    await addSpend(observer.db, 0.25);
    await addSpend(observer.db, 0.5);
    expect(await spentToday(observer.db)).toBeCloseTo(before + 0.75, 6);
    const id = await createThread(observer.db, { workspaceId, createdBy: userId, title: "old" });
    await owner.sql`update observer.copilot_threads set updated_at = now() - interval '31 days' where id = ${id}`;
    await purgeThreadsBefore(observer.db, new Date(Date.now() - 30 * 86_400_000));
    expect(await loadThread(observer.db, workspaceId, id)).toBeNull();
  });
  it("reserves spend atomically, refuses overlapping excess and settles actual usage", async () => {
    await owner.sql`delete from observer.copilot_spend`;
    const reservations = await Promise.all([
      reserveCopilotSpend(observer.db, 0.6, 1),
      reserveCopilotSpend(observer.db, 0.6, 1),
    ]);
    expect(reservations.filter(Boolean)).toHaveLength(1);
    expect(await spentToday(observer.db)).toBeCloseTo(0.6, 6);
    const held = reservations.find((r) => r !== null)!;
    await settleCopilotSpend(observer.db, held, 0.1);
    expect(await spentToday(observer.db)).toBeCloseTo(0.1, 6);
    expect(await reserveCopilotSpend(observer.db, 1, 1)).toBeNull();
    const next = await reserveCopilotSpend(observer.db, 0.6, 1);
    expect(next).not.toBeNull();
    expect(await spentToday(observer.db)).toBeCloseTo(0.7, 6);
  });
});
