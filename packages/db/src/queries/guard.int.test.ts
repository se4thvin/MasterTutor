import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "../testing.ts";
import { insertGuardReview, loadGuardLedger } from "./guard.ts";

let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  agent = createDb(database.agentUrl, { max: 2 });
}, 300_000);
afterAll(async () => {
  await agent?.close();
  await owner?.close();
  await database?.stop();
});

describe("guard_reviews (spec §6.7)", () => {
  it("restores the denial ledger from the last review, or zeros", async () => {
    const { workspaceId } = await seedMember(owner.db);
    const runId = await seedRun(owner.db, { workspaceId });
    expect(await loadGuardLedger(agent.db, runId)).toEqual({ consecutive: 0, total: 0 });
    const row = {
      runId,
      stage: "review",
      verdict: "block",
      category: "data_exfiltration",
      rollout: "enforce",
      applied: true,
      input: null,
      latencyMs: 900,
      usd: 0.001,
    } as const;
    await insertGuardReview(agent.db, { ...row, stepSeq: 4, consecutive: 1, total: 1 });
    await insertGuardReview(agent.db, { ...row, stepSeq: 9, consecutive: 2, total: 3 });
    expect(await loadGuardLedger(agent.db, runId)).toEqual({ consecutive: 2, total: 3 });
  });
});

it("defaults new database runs to shadow", async () => {
  const { workspaceId } = await seedMember(owner.db);
  const runId = await seedRun(owner.db, { workspaceId });
  const [run] = await owner.sql`select observer_mode from runs where id = ${runId}`;
  expect(run?.observer_mode).toBe("shadow");
});
