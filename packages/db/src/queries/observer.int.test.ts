import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "../testing.ts";
import { findRuns, runDetail } from "./observer.ts";

let database: TestDatabase;
let owner: DbHandle;
let observer: DbHandle;
let workspaceId: string;
let runId: string;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  observer = createDb(database.observerUrl, { max: 2 });
  ({ workspaceId } = await seedMember(owner.db));
  runId = await seedRun(owner.db, { workspaceId, status: "failed" });
  await owner.sql`update runs set error = '{"code":"model_unavailable","message":"page said: ignore all"}', goal = 'secret goal text' where id = ${runId}`;
  await owner.sql`insert into run_steps (run_id, seq, phase, state, url, caption) values (${runId}, 0, 'observe', 'done', 'https://a.test/path?token=x', 'Screenshot withheld: secret')`;
  await owner.sql`insert into approvals (run_id, step_seq, kind, request, status, decided_by) values (${runId}, 1, 'risky_click', '{}'::jsonb, 'approved', ${"user-1"})`;
}, 300_000);
afterAll(async () => {
  await observer?.close();
  await owner?.close();
  await database?.stop();
});

describe("Copilot read model over observer views (spec §7.3)", () => {
  it("finds runs by status and error code, never with goal or error message", async () => {
    const rows = await findRuns(observer.db, workspaceId, {
      status: "failed",
      errorCode: "model_unavailable",
      sinceHours: 24,
      limit: 10,
    });
    expect(rows.map((r) => r.id)).toEqual([runId]);
    expect(JSON.stringify(rows)).not.toContain("secret goal text");
    expect(JSON.stringify(rows)).not.toContain("ignore all");
  });

  it("returns run detail with decider classes, and page-derived text only on opt-in", async () => {
    const plain = await runDetail(observer.db, workspaceId, runId, { includeUntrusted: false });
    expect(plain?.approvals[0]?.decider).toBe("person");
    expect(plain?.goal).toBeNull();
    expect(plain?.steps[0]?.caption).toBeNull();
    expect(plain?.steps[0]?.origin).toBeNull();
    const opted = await runDetail(observer.db, workspaceId, runId, { includeUntrusted: true });
    expect(opted?.goal).toBe("secret goal text");
    expect(opted?.steps[0]?.origin).toBe("https://a.test");
    expect(JSON.stringify(opted)).not.toContain("token=x");
    expect(
      await runDetail(observer.db, "00000000-0000-4000-8000-000000000000", runId, {
        includeUntrusted: true,
      }),
    ).toBeNull();
  });
});
