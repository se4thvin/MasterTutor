import { EMPTY_USAGE } from "@mastertutor/contracts";
import { METRIC } from "@mastertutor/contracts/telemetry";
import { createDb, runs, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { NO_SESSION_STORE, StepStore } from "./step-store.ts";

const OWNER = "telemetry-test";
let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let telemetry: TestTelemetry;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl);
  agent = createDb(database.agentUrl);
  telemetry = installTestTelemetry();
});
afterAll(async () => {
  await telemetry?.shutdown();
  await agent?.close();
  await owner?.close();
  await database?.stop();
});

async function openStore(usd: number) {
  const workspaceId = await seedWorkspace(owner.db);
  const row = await insertRun(owner.db, {
    workspaceId,
    goal: "g",
    status: "running",
    leaseOwner: OWNER,
  });
  await owner.db
    .update(runs)
    .set({ usage: { ...EMPTY_USAGE, usd } })
    .where(eq(runs.id, row.id));
  const store = await StepStore.open({
    db: agent.db,
    storage: createMemoryStorage(),
    sessionStore: NO_SESSION_STORE,
    owner: OWNER,
    run: row,
  });
  return { store, row };
}

describe("StepStore telemetry (seam 5)", () => {
  it("counts committed spend as the change in runs.usage.usd, after the commit", async () => {
    const { store } = await openStore(1);
    await store.commit({ run: { usage: { ...EMPTY_USAGE, usd: 1.25 } } });
    await store.commit({ run: { usage: { ...EMPTY_USAGE, usd: 1.75 } } });
    const [spend] = await telemetry.metric(METRIC.spendUsd.name);
    expect(spend!.value).toBeCloseTo(0.75);
    expect(telemetry.spans().filter((s) => s.name === "mt.step.commit")).toHaveLength(2);
  });

  it("counts nothing for a commit that rolls back, then the full change once one commits", async () => {
    const spend = async () => (await telemetry.metric(METRIC.spendUsd.name))[0]?.value ?? 0;
    const failures = async () =>
      (await telemetry.metric(METRIC.runFailures.name)).find(
        (p) => p.attributes["mt.error.code"] === "rolled_back_canary",
      )?.value ?? 0;
    const { store, row } = await openStore(0);
    const before = await spend();
    await owner.db.update(runs).set({ leaseOwner: "someone-else" }).where(eq(runs.id, row.id));
    await expect(
      store.commit({
        run: { usage: { ...EMPTY_USAGE, usd: 2 } },
        transition: {
          from: ["running"],
          to: "failed",
          waitReason: null,
          reason: "x",
          error: { code: "rolled_back_canary", message: "never committed" },
        },
      }),
    ).rejects.toMatchObject({ name: "LeaseLost" });
    expect(await spend()).toBeCloseTo(before);
    expect(await failures()).toBe(0);
    await owner.db.update(runs).set({ leaseOwner: OWNER }).where(eq(runs.id, row.id));
    await store.commit({ run: { usage: { ...EMPTY_USAGE, usd: 2.5 } } });
    expect((await spend()) - before).toBeCloseTo(2.5);
  });

  it("counts a failed run by its error code", async () => {
    const { store } = await openStore(0);
    await store.commit({
      transition: {
        from: ["running"],
        to: "failed",
        waitReason: null,
        reason: "x",
        error: { code: "model_request_rejected", message: "The model rejected the request." },
      },
    });
    expect(
      (await telemetry.metric(METRIC.runFailures.name)).find(
        (p) => p.attributes["mt.error.code"] === "model_request_rejected",
      )?.value,
    ).toBe(1);
  });
});
