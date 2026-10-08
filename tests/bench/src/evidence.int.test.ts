import { createDb, type DbHandle } from "@mastertutor/db";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseTrace, traceSql } from "./evidence.ts";
import { computer, observe, readPage } from "./trace-fixtures.ts";

let tdb: TestDatabase;
let owner: DbHandle;
beforeAll(async () => {
  tdb = await startTestDatabase();
  owner = createDb(tdb.ownerUrl, { max: 1 });
});
afterAll(async () => {
  await owner?.close();
  await tdb?.stop();
});

describe("traceSql against the real run_steps and approvals tables", () => {
  it("returns rows parseTrace accepts, in seq order, with approvals and safety codes", async () => {
    const { workspaceId } = await seedMember(owner.db);
    const runId = await seedRun(owner.db, { workspaceId, status: "completed" });
    const url = "https://learn.example/book/1";
    const rows = [
      observe(url),
      computer({ type: "click", x: 1, y: 1, button: "left" }),
      readPage(url, "3 of 3"),
    ];
    for (const [i, row] of rows.entries())
      await owner.sql`insert into run_steps (run_id, seq, phase, state, url, screenshot_key, action, result)
        values (${runId}, ${i + 1}, ${row.phase}, ${row.state}, ${row.url}, ${row.screenshotKey},
                ${row.action === null ? null : JSON.stringify(row.action)}::jsonb, ${JSON.stringify(row.result)}::jsonb)`;
    await owner.sql`update runs set current_url = ${url} where id = ${runId}`;
    await owner.sql`insert into approvals (run_id, step_seq, kind, request, status, decided_by) values
      (${runId}, 2, 'risky_click', ${JSON.stringify({ kind: "risky_click", action: { type: "click", x: 1, y: 1, button: "left" }, label: "Go", url, screenshotKey: null, safetyChecks: [{ code: "malicious_instructions", message: "m" }] })}::jsonb, 'denied', 'u1')`;
    const [row] = await owner.sql.unsafe(traceSql(runId));
    const trace = parseTrace(runId, Object.values(row!)[0]);
    expect(trace.steps.map((s) => [s.seq, s.phase, s.url, s.interaction])).toEqual([
      [1, "observe", url, false],
      [2, "act", url, true],
      [3, "act", url, false],
    ]);
    expect(trace.steps[2]!.readPage).toMatchObject({ text: "3 of 3" });
    expect(trace.finalUrl).toBe(url);
    expect(trace.approvals).toEqual([
      {
        kind: "risky_click",
        status: "denied",
        decidedBy: "u1",
        origin: null,
        safetyCodes: ["malicious_instructions"],
      },
    ]);
  });
});
