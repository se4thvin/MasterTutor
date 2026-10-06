import { encodeNotify } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { createDb, runEvents, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { waitFor } from "../testing/wait.ts";
import { emitRunEvent } from "./emit.ts";
import { listenForAgentNotifications } from "./listen.ts";

let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let runId: string;
const log = createLogger({ service: "test", level: "silent" });

beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl);
  agent = createDb(database.agentUrl);
  const workspaceId = await seedWorkspace(owner.db);
  runId = (await insertRun(owner.db, { workspaceId })).id;
});
afterAll(async () => {
  await agent?.close();
  await owner?.close();
  await database?.stop();
});

describe("emitRunEvent", () => {
  it("stores the event and notifies with ids only", async () => {
    const received: string[] = [];
    const subscription = await owner.sql.listen("run_event", (text) => void received.push(text));
    const eventId = await agent.db.transaction((tx) =>
      emitRunEvent(tx, runId, { type: "control", holder: "user" }),
    );
    await waitFor(() => received.length === 1, { label: "run_event notify" });
    expect(JSON.parse(received[0] ?? "{}")).toEqual({ runId, eventId });
    const [row] = await owner.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.id, Number(eventId)));
    expect(row?.type).toBe("control");
    expect(row?.payload).toEqual({ type: "control", holder: "user" });
    await subscription.unlisten();
  });

  it("rejects invalid events before writing", async () => {
    const before = await owner.db.select().from(runEvents);
    await expect(
      agent.db.transaction((tx) =>
        emitRunEvent(tx, runId, { type: "screencast" } as unknown as Parameters<
          typeof emitRunEvent
        >[2]),
      ),
    ).rejects.toThrow();
    expect(await owner.db.select().from(runEvents)).toHaveLength(before.length);
  });

  it("notifies nothing when the transaction rolls back", async () => {
    const received: string[] = [];
    const subscription = await owner.sql.listen("run_event", (text) => void received.push(text));
    await expect(
      agent.db.transaction(async (tx) => {
        await emitRunEvent(tx, runId, { type: "control", holder: "agent" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toEqual([]);
    await subscription.unlisten();
  });
});

describe("listenForAgentNotifications", () => {
  it("decodes payloads and ignores malformed ones", async () => {
    const wakes: unknown[] = [];
    const stop = await listenForAgentNotifications(
      agent.sql,
      { run_wake: (payload) => void wakes.push(payload) },
      log,
    );
    await owner.sql.notify("run_wake", "not json");
    await owner.sql.notify("run_wake", encodeNotify("run_wake", { runId, reason: "approval" }));
    await waitFor(() => wakes.length === 1, { label: "run_wake handler" });
    expect(wakes[0]).toEqual({ runId, reason: "approval" });
    await stop();
  });
});
