import { randomUUID } from "node:crypto";
import { createLogger } from "@mastertutor/contracts/server";
import {
  createDb,
  recordLiveViewer,
  requestTakeover,
  runs,
  session,
  type DbHandle,
} from "@mastertutor/db";
import {
  leaseSlotForTest,
  releaseSlotForTest,
  seedMember,
  seedRun,
  startTestDatabase,
  type TestDatabase,
} from "@mastertutor/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { waitFor } from "../testing/wait.ts";
import { NekoApiError, type NekoAdmin } from "./neko-admin.ts";
import { startLiveRevocation } from "./revocation.ts";

const SLOT = "browser-1";
const log = createLogger({ service: "test", level: "silent" });
let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let stop: (() => Promise<void>) | undefined;

/** Records each n.eko admin call; `failures` calls fail first (the slot not answering). */
function fakeAdmin(failures = 0): NekoAdmin & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    request: async (slotName, method, path) => {
      calls.push(`${slotName} ${method} ${path}`);
      if (failures-- > 0) throw new NekoApiError(502, path);
      return undefined;
    },
  };
}

/** A signed-in person viewing and controlling a leased run. */
async function openLiveView(): Promise<{ userId: string; runId: string }> {
  const person = await seedMember(owner.db);
  await owner.db.insert(session).values({
    id: randomUUID(),
    token: randomUUID(),
    userId: person.userId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const runId = await seedRun(owner.db, { workspaceId: person.workspaceId });
  await leaseSlotForTest(owner.db, SLOT, runId);
  await recordLiveViewer(owner.db, runId, person.userId);
  await requestTakeover(owner.db, { runId, userId: person.userId });
  return { userId: person.userId, runId };
}

async function runRow(runId: string) {
  const [row] = await owner.db.select().from(runs).where(eq(runs.id, runId));
  return row!;
}

const CLOSED = [`${SLOT} POST /api/sessions/user/disconnect`, `${SLOT} DELETE /api/sessions/user`];

beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl);
  agent = createDb(database.agentUrl);
});
afterEach(async () => {
  await stop?.();
  stop = undefined;
  await releaseSlotForTest(owner.db, SLOT);
});
afterAll(async () => {
  await agent?.close();
  await owner?.close();
  await database?.stop();
});

describe("live revocation reconciles what it missed", () => {
  it("closes a view whose sign-out was notified while the agent was not listening", async () => {
    const { userId, runId } = await openLiveView();
    // The agent is down: the NOTIFY from this sign-out reaches nobody.
    await owner.db.delete(session).where(eq(session.userId, userId));

    const admin = fakeAdmin();
    stop = await startLiveRevocation({ db: agent, admin, log });

    await waitFor(async () => (await runRow(runId)).liveViewerId === null, {
      label: "missed sign-out swept",
    });
    expect(admin.calls).toEqual(CLOSED);
    expect(await runRow(runId)).toMatchObject({ controller: "agent", controlUserId: null });
  });

  it("sweeps again when its LISTEN reconnects (a session that expired unnoticed)", async () => {
    const admin = fakeAdmin();
    stop = await startLiveRevocation({ db: agent, admin, log });
    const { userId, runId } = await openLiveView();
    // No trigger fires for an expiry; then the LISTEN connection drops and comes back.
    await owner.db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(session.userId, userId));
    await owner.sql`select pg_terminate_backend(pid) from pg_stat_activity
      where usename = 'agent_role' and query ilike 'listen%'`;

    await waitFor(async () => (await runRow(runId)).liveViewerId === null, {
      label: "swept after reconnect",
      timeoutMs: 15_000,
    });
    expect(admin.calls).toEqual(CLOSED);
  });

  it("retries a close that fails, and keeps the view recorded until it closes", async () => {
    const admin = fakeAdmin(1);
    stop = await startLiveRevocation({ db: agent, admin, log, retryBaseMs: 300 });
    const { userId, runId } = await openLiveView();
    await owner.db.delete(session).where(eq(session.userId, userId));

    await waitFor(() => admin.calls.length === 1, { label: "first close attempt" });
    expect((await runRow(runId)).liveViewerId).toBe(userId);
    await waitFor(async () => (await runRow(runId)).liveViewerId === null, {
      label: "retried close",
    });
    expect(admin.calls).toEqual([CLOSED[0], ...CLOSED]);
  });
});
