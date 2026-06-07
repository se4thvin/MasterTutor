import { randomUUID } from "node:crypto";
import { createLogger, deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import {
  createDb,
  recordLiveViewer,
  requestTakeover,
  runEvents,
  runs,
  session,
  type DbHandle,
} from "@mastertutor/db";
import { leaseSlotForTest, releaseSlotForTest, seedMember, seedRun } from "@mastertutor/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BEHAVIOUR_NEKO_ADMIN_SECRET,
  BEHAVIOUR_NEKO_MEMBER_SECRET,
  nekoBaseUrlForTests,
} from "../../../../tests/behaviour/constants.ts";
import { behaviourEnv } from "../../../../tests/behaviour/env.ts";
import { restartSlot } from "../../../../tests/behaviour/slot-tools.ts";
import { waitFor } from "../testing/wait.ts";
import { createNekoAdmin } from "./neko-admin.ts";
import { startLiveRevocation } from "./revocation.ts";

const SLOT = "browser-1";
const base = nekoBaseUrlForTests(SLOT);
const log = createLogger({ service: "behaviour", level: "silent" });
let owner: DbHandle;
let agentDb: DbHandle;
let stop: () => Promise<void>;

beforeAll(async () => {
  // A fresh boot profile: an earlier file may have left a live view connected in this slot.
  await restartSlot(SLOT);
  const env = behaviourEnv();
  owner = createDb(env.ownerUrl, { max: 2 });
  agentDb = createDb(env.agentUrl, { max: 2 });
  stop = await startLiveRevocation({
    db: agentDb,
    admin: createNekoAdmin({ adminSecret: BEHAVIOUR_NEKO_ADMIN_SECRET, baseUrl: () => base }),
    log,
  });
});
afterAll(async () => {
  await stop?.();
  await releaseSlotForTest(owner.db, SLOT);
  await Promise.all([owner?.close(), agentDb?.close()]);
});

describe("revocation reaches open live views (sign-out, removal from the workspace)", () => {
  it("closes the person's n.eko websocket when they sign out, and their control goes back", async () => {
    const person = await seedMember(owner.db);
    const runId = await seedRun(owner.db, { workspaceId: person.workspaceId });
    await leaseSlotForTest(owner.db, SLOT, runId);
    await recordLiveViewer(owner.db, runId, person.userId);
    await requestTakeover(owner.db, { runId, userId: person.userId });
    // The live view as openLive set it up: the user member's session, its websocket open.
    const token = await loginNeko({
      baseUrl: base,
      username: "user",
      password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, SLOT),
    });
    const socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
    let closed = false;
    socket.addEventListener("close", () => (closed = true));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("n.eko websocket failed")));
    });

    // Sign-out: Better Auth deletes the session row.
    await owner.db.insert(session).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: person.userId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await owner.db.delete(session).where(eq(session.userId, person.userId));

    await waitFor(() => closed, { label: "live view closed", timeoutMs: 10_000 });
    // ForwardAuth only checks at the upgrade: the n.eko session itself must be gone too.
    const whoami = await fetch(`${base}/api/whoami`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(whoami.status).toBe(401);
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, runId));
    expect(row).toMatchObject({ controller: "agent", controlUserId: null, liveViewerId: null });
    const events = (await owner.db.select().from(runEvents).where(eq(runEvents.runId, runId))).map(
      (e) => e.payload,
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "live_revoked" }));
  });
});
