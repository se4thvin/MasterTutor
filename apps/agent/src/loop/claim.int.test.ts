import { browserSlots, createDb, runEvents, runs, settings, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LeaseLost } from "../runtime/errors.ts";
import {
  listRestartingSlots,
  markSlotIdle,
  reclaimExpiredSlots,
  releaseSlot,
} from "../slots/leases.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { NO_SESSION_STORE, StepStore } from "./step-store.ts";
import { cancelRunsForKill, claimNextRun, killedWorkspaces, renewLeases } from "./claim.ts";

const SLOTS = ["browser-1", "browser-2", "browser-3"];
const OPTIONS = { owner: "agent-a", slots: SLOTS, leaseMs: 30_000 };
let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let workspaceId: string;

async function setIdle(names: string[]) {
  await owner.db
    .update(browserSlots)
    .set({ state: "restarting", runId: null, leaseOwner: null, leaseExpiresAt: null });
  if (names.length) {
    await owner.db
      .update(browserSlots)
      .set({ state: "idle" })
      .where(inArray(browserSlots.name, names));
  }
}

beforeAll(async () => {
  database = await startTestDatabase({ slots: SLOTS });
  owner = createDb(database.ownerUrl);
  agent = createDb(database.agentUrl, { max: 20 });
  workspaceId = await seedWorkspace(owner.db);
});
beforeEach(async () => {
  await owner.db.update(runs).set({ slotName: null });
  await owner.db.delete(runs);
  await owner.db.update(settings).set({ killSwitch: false });
});
afterAll(async () => {
  await agent?.close();
  await owner?.close();
  await database?.stop();
});

describe("claimNextRun", () => {
  it("keeps one slot warm: a queued run needs two idle slots", async () => {
    await insertRun(owner.db, { workspaceId });
    await setIdle(["browser-1"]);
    expect(await claimNextRun(agent.db, OPTIONS)).toBeNull();
    await setIdle(["browser-1", "browser-2"]);
    const claim = await claimNextRun(agent.db, OPTIONS);
    expect(claim?.slotName).toBe("browser-1");
    expect(claim?.priority).toBe("queued");
    expect(claim?.run.status).toBe("running");
    expect(claim?.leaseToken).toMatch(/^agent-a:[0-9a-f-]{36}$/);
    expect(claim?.reclaimedSlot).toBeNull();
    expect(claim?.run.leaseOwner).toBe(claim?.leaseToken);
    const [slot] = await owner.db
      .select()
      .from(browserSlots)
      .where(eq(browserSlots.name, "browser-1"));
    expect(slot).toMatchObject({
      state: "leased",
      runId: claim?.run.id,
      leaseOwner: claim?.leaseToken,
    });
    const events = await owner.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, claim!.run.id));
    expect(events.map((event) => event.type).sort()).toEqual(["slot", "status"]);
  });

  it("lets a wake take the last idle slot, and claims wakes before queued runs", async () => {
    const queued = await insertRun(owner.db, { workspaceId });
    const sleeping = await insertRun(owner.db, { workspaceId, status: "sleeping" });
    await owner.db
      .update(runs)
      .set({ wakeRequestedAt: sql`now()` })
      .where(eq(runs.id, sleeping.id));
    await setIdle(["browser-2"]);
    const claim = await claimNextRun(agent.db, OPTIONS);
    expect(claim?.run.id).toBe(sleeping.id);
    expect(claim?.priority).toBe("wake");
    expect(claim?.run.wakeRequestedAt).toBeNull();
    expect(await claimNextRun(agent.db, OPTIONS)).toBeNull();
    expect((await owner.db.select().from(runs).where(eq(runs.id, queued.id)))[0]?.status).toBe(
      "queued",
    );
  });

  it("is race-free under SKIP LOCKED: 10 racing claims over 3 idle slots start exactly 2 queued runs", async () => {
    for (let i = 0; i < 10; i++) await insertRun(owner.db, { workspaceId });
    await setIdle(SLOTS);
    const claims = (
      await Promise.all(Array.from({ length: 10 }, () => claimNextRun(agent.db, OPTIONS)))
    ).filter((claim) => claim !== null);
    expect(claims.length).toBeLessThanOrEqual(2);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    // Racing claims may lock the idle slots and back off; a drain afterwards must reach exactly 2.
    for (;;) {
      const more = await claimNextRun(agent.db, OPTIONS);
      if (!more) break;
      claims.push(more);
    }
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((claim) => claim.slotName)).size).toBe(2);
    expect(new Set(claims.map((claim) => claim.run.id)).size).toBe(2);
    const idle = await owner.db.select().from(browserSlots).where(eq(browserSlots.state, "idle"));
    expect(idle).toHaveLength(1);
  });

  it("reclaims a running run with an expired lease on a fresh slot and retires its old slot", async () => {
    await setIdle(["browser-2", "browser-3"]);
    const run = await insertRun(owner.db, { workspaceId, status: "running", leaseOwner: "dead" });
    await owner.db
      .update(browserSlots)
      .set({
        state: "leased",
        runId: run.id,
        leaseOwner: "dead",
        leaseExpiresAt: sql`now() - interval '1 minute'`,
      })
      .where(eq(browserSlots.name, "browser-1"));
    await owner.db
      .update(runs)
      .set({ slotName: "browser-1", leaseExpiresAt: sql`now() - interval '1 minute'` })
      .where(eq(runs.id, run.id));
    const claim = await claimNextRun(agent.db, OPTIONS);
    expect(claim?.run.id).toBe(run.id);
    expect(claim?.priority).toBe("wake");
    expect(claim?.slotName).toBe("browser-2");
    // Returned so the agent restarts the retired slot at once: a stale worker loses its browser (I2).
    expect(claim?.reclaimedSlot).toBe("browser-1");
    const [old] = await owner.db
      .select()
      .from(browserSlots)
      .where(eq(browserSlots.name, "browser-1"));
    expect(old).toMatchObject({ state: "restarting", runId: null });
  });

  it("refuses claims while the workspace kill switch is on, and cancels unowned runs", async () => {
    const queued = await insertRun(owner.db, { workspaceId });
    await setIdle(SLOTS);
    await owner.db.update(settings).set({ killSwitch: true });
    expect(await claimNextRun(agent.db, OPTIONS)).toBeNull();
    expect(await killedWorkspaces(agent.db)).toEqual([workspaceId]);
    expect(await cancelRunsForKill(agent.db, [workspaceId])).toEqual([queued.id]);
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, queued.id));
    expect(row).toMatchObject({ status: "cancelled", error: { code: "kill_switch" } });
  });
});

describe("leases", () => {
  it("renews both leases and reports a lost lease", async () => {
    await insertRun(owner.db, { workspaceId });
    await setIdle(["browser-1", "browser-2"]);
    const claim = await claimNextRun(agent.db, OPTIONS);
    if (!claim) throw new Error("no claim");
    const lease = {
      runId: claim.run.id,
      slotName: claim.slotName,
      owner: claim.leaseToken,
      leaseMs: 30_000,
    };
    await renewLeases(agent.db, lease);
    await owner.db.update(runs).set({ leaseOwner: "agent-b" }).where(eq(runs.id, claim.run.id));
    await expect(renewLeases(agent.db, lease)).rejects.toBeInstanceOf(LeaseLost);
  });

  it("gives every claim its own lease token: a stale claim of the same agent can neither renew nor commit", async () => {
    await insertRun(owner.db, { workspaceId });
    await setIdle(["browser-1", "browser-2", "browser-3"]);
    const first = await claimNextRun(agent.db, OPTIONS);
    if (!first) throw new Error("no claim");
    const stale = await StepStore.open({
      db: agent.db,
      storage: createMemoryStorage(),
      sessionStore: NO_SESSION_STORE,
      owner: first.leaseToken,
      run: first.run,
    });
    await stale.commit({}); // still ours
    // A heartbeat outage: the lease expires and the SAME agent re-claims its own run.
    await owner.db
      .update(runs)
      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(runs.id, first.run.id));
    const second = await claimNextRun(agent.db, OPTIONS);
    expect(second?.run.id).toBe(first.run.id);
    expect(second?.leaseToken).not.toBe(first.leaseToken);
    await expect(stale.commit({})).rejects.toBeInstanceOf(LeaseLost);
    await expect(
      renewLeases(agent.db, {
        runId: first.run.id,
        slotName: first.slotName,
        owner: first.leaseToken,
        leaseMs: 30_000,
      }),
    ).rejects.toBeInstanceOf(LeaseLost);
  });

  it("releases a slot into restarting and clears runs.slot_name", async () => {
    await insertRun(owner.db, { workspaceId });
    await setIdle(["browser-1", "browser-2"]);
    const claim = await claimNextRun(agent.db, OPTIONS);
    if (!claim) throw new Error("no claim");
    await agent.db.transaction((tx) =>
      releaseSlot(tx, { name: claim.slotName, runId: claim.run.id }),
    );
    const [slot] = await owner.db
      .select()
      .from(browserSlots)
      .where(eq(browserSlots.name, claim.slotName));
    expect(slot).toMatchObject({ state: "restarting", runId: null, leaseOwner: null });
    expect(
      (await owner.db.select().from(runs).where(eq(runs.id, claim.run.id)))[0]?.slotName,
    ).toBeNull();
  });

  it("reclaims slots whose lease expired", async () => {
    const run = await insertRun(owner.db, { workspaceId, status: "running" });
    await setIdle([]);
    await owner.db
      .update(browserSlots)
      .set({
        state: "leased",
        runId: run.id,
        leaseOwner: "dead",
        leaseExpiresAt: sql`now() - interval '1 second'`,
      })
      .where(eq(browserSlots.name, "browser-3"));
    await owner.db.update(runs).set({ slotName: "browser-3" }).where(eq(runs.id, run.id));
    expect(await reclaimExpiredSlots(agent.db, SLOTS)).toEqual(["browser-3"]);
    expect((await owner.db.select().from(runs).where(eq(runs.id, run.id)))[0]?.slotName).toBeNull();
  });

  it("tells a never-leased slot from one a run left behind, so boot resets only the latter", async () => {
    // As seeding leaves them: restarting, never stamped.
    await setIdle([]);
    await owner.db.update(browserSlots).set({ restartedAt: null });
    // browser-1 and browser-2 come up; a run leases browser-1 and releases it.
    for (const name of ["browser-1", "browser-2"]) await markSlotIdle(agent.db, name);
    await insertRun(owner.db, { workspaceId });
    const claim = await claimNextRun(agent.db, OPTIONS);
    if (!claim) throw new Error("no claim");
    await agent.db.transaction((tx) =>
      releaseSlot(tx, { name: claim.slotName, runId: claim.run.id }),
    );
    // browser-3 is held by a dead agent mid-run. Even a row never stamped by markSlotIdle
    // must come back as needing a reset once its lease is reclaimed.
    const stale = await insertRun(owner.db, { workspaceId, status: "running" });
    await owner.db
      .update(browserSlots)
      .set({
        state: "leased",
        runId: stale.id,
        leaseOwner: "dead",
        leaseExpiresAt: sql`now() - interval '1 second'`,
      })
      .where(eq(browserSlots.name, "browser-3"));
    await owner.db.update(runs).set({ slotName: "browser-3" }).where(eq(runs.id, stale.id));
    expect(await reclaimExpiredSlots(agent.db, SLOTS)).toEqual(["browser-3"]);
    // browser-2 only kept the claim's warm-slot rule happy; put it back as seeding left it.
    await owner.db
      .update(browserSlots)
      .set({ state: "restarting", restartedAt: null })
      .where(eq(browserSlots.name, "browser-2"));

    expect(await listRestartingSlots(agent.db, SLOTS)).toEqual([
      { name: "browser-1", neverLeased: false },
      { name: "browser-2", neverLeased: true },
      { name: "browser-3", neverLeased: false },
    ]);
  });

  it("writes slot restarting and runs.slot_name = null atomically (rolled back together)", async () => {
    await insertRun(owner.db, { workspaceId });
    await setIdle(["browser-1", "browser-2"]);
    const claim = await claimNextRun(agent.db, OPTIONS);
    if (!claim) throw new Error("no claim");
    await expect(
      agent.db.transaction(async (tx) => {
        await releaseSlot(tx, { name: claim.slotName, runId: claim.run.id });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const [slot] = await owner.db
      .select()
      .from(browserSlots)
      .where(eq(browserSlots.name, claim.slotName));
    const [run] = await owner.db.select().from(runs).where(eq(runs.id, claim.run.id));
    expect(slot).toMatchObject({ state: "leased", runId: claim.run.id });
    expect(run?.slotName).toBe(claim.slotName);
    // A committed release frees the slot name for the next run: leasing it again must not hit runs_slot_name_uq.
    await agent.db.transaction((tx) =>
      releaseSlot(tx, { name: claim.slotName, runId: claim.run.id }),
    );
    await owner.db
      .update(browserSlots)
      .set({ state: "idle" })
      .where(eq(browserSlots.name, claim.slotName));
    await owner.db
      .update(browserSlots)
      .set({ state: "idle" })
      .where(eq(browserSlots.name, "browser-3"));
    const next = await insertRun(owner.db, { workspaceId });
    const second = await claimNextRun(agent.db, OPTIONS);
    expect(second?.run.id).toBe(next.id);
    expect(second?.slotName).toBe(claim.slotName);
  });
});
