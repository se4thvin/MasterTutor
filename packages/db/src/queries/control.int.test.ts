import { readFile } from "node:fs/promises";
import { decodeNotify } from "@mastertutor/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { runEvents, runs, workspaces } from "../schema/index.ts";
import { startTestDatabase, type TestDatabase } from "../testing.ts";
import { notifyRunControl, readControlUser, returnControlToAgent } from "./control.ts";
import { emitRunEvent } from "./events.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let workspaceId: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = createDb(testDb.ownerUrl, { max: 2 });
  agent = createDb(testDb.agentUrl, { max: 2 });
  const [workspace] = await owner.db
    .insert(workspaces)
    .values({ name: "Test" })
    .returning({ id: workspaces.id });
  workspaceId = workspace!.id;
});
afterAll(async () => {
  await Promise.all([owner?.close(), agent?.close()]);
  await testDb?.stop();
});

async function newRun(): Promise<string> {
  const [run] = await owner.db
    .insert(runs)
    .values({ workspaceId, goal: "control", allowedOrigins: ["https://example.com"] })
    .returning({ id: runs.id });
  return run!.id;
}

// drizzle wraps the driver error; the CHECK's name is on its cause.
const violates = { cause: { constraint_name: "runs_control_user_matches_controller" } };

describe("runs.control_user_id (F8)", () => {
  it("is set exactly when the user holds control", async () => {
    const runId = await newRun();
    await expect(
      owner.db.update(runs).set({ controller: "user" }).where(eq(runs.id, runId)),
    ).rejects.toMatchObject(violates);
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: "user_a" })
      .where(eq(runs.id, runId));
    await expect(
      owner.db.update(runs).set({ controller: "agent" }).where(eq(runs.id, runId)),
    ).rejects.toMatchObject(violates);
  });
});

describe("control queries (F4)", () => {
  it("returns control to the agent once, and reports who holds control", async () => {
    const runId = await newRun();
    expect(await readControlUser(agent.db, runId)).toBeNull();
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: "user_a" })
      .where(eq(runs.id, runId));
    expect(await readControlUser(agent.db, runId)).toBe("user_a");
    expect(await agent.db.transaction((tx) => returnControlToAgent(tx, runId))).toBe(true);
    expect(await agent.db.transaction((tx) => returnControlToAgent(tx, runId))).toBe(false);
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, runId));
    expect(row).toMatchObject({ controller: "agent", controlUserId: null });
  });

  it("notifies run_control with the run id only, on commit", async () => {
    const runId = await newRun();
    const received: string[] = [];
    const { unlisten } = await owner.sql.listen("run_control", (payload) => received.push(payload));
    try {
      await agent.db.transaction(async (tx) => {
        await notifyRunControl(tx, runId);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(received).toEqual([]);
      });
      const deadline = Date.now() + 3_000;
      while (received.length === 0 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(received.map((p) => decodeNotify("run_control", p))).toEqual([{ runId }]);
    } finally {
      await unlisten();
    }
  });
});

describe("emitRunEvent in @mastertutor/db (F7)", () => {
  it("is usable by the web role inside a transaction", async () => {
    const web = createDb(testDb.webUrl, { max: 1 });
    try {
      const runId = await newRun();
      const eventId = await web.db.transaction((tx) =>
        emitRunEvent(tx, runId, { type: "user_message", text: "Logged in" }),
      );
      const [row] = await owner.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.id, Number(eventId)));
      expect(row?.payload).toEqual({ type: "user_message", text: "Logged in" });
    } finally {
      await web.close();
    }
  });
});

describe("migration 0005_live_control_user", () => {
  it("backfills runs the user already held, so the CHECK can be added", async () => {
    const runId = await newRun();
    const migration = await readFile(
      new URL("../../migrations/0005_live_control_user.sql", import.meta.url),
      "utf8",
    );
    await owner.sql.begin(async (tx) => {
      // Back to the pre-0005 shape, with a run a user holds (a database migrated before B6).
      await tx`alter table runs drop constraint runs_control_user_matches_controller`;
      await tx`alter table runs drop column control_user_id`;
      await tx`update runs set controller = 'user' where id = ${runId}`;
      for (const statement of migration.split("--> statement-breakpoint"))
        await tx.unsafe(statement);
    });
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, runId));
    expect(row).toMatchObject({ controller: "user", controlUserId: "legacy" });
  });
});
