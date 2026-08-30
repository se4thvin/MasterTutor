import { APPROVAL_KINDS, ApprovalRequest, RunEvent } from "@mastertutor/contracts";
import { createDb, type DbHandle } from "@mastertutor/db";
import { seedMember, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED, seedSql } from "./seed.ts";

let database: TestDatabase | undefined;
let handle: DbHandle | undefined;
let ownerId = "";

beforeAll(async () => {
  database = await startTestDatabase({ slots: ["browser-1"] });
  handle = createDb(database.ownerUrl, { max: 1 });
  ({ userId: ownerId } = await seedMember(handle.db, { role: "owner" }));
  await handle.sql.unsafe(seedSql()).simple();
});

afterAll(async () => {
  await handle?.close();
  await database?.stop();
});

describe("QA seed against the migrated schema (P8-6, preflight §7)", () => {
  it("inserts every run: all CHECKs, foreign keys and the folders trigger hold", async () => {
    const rows = await handle!.sql<{ id: string }[]>`select id from runs`;
    expect(rows.map((r) => r.id).sort()).toEqual(
      [...Object.values(SEED.runs), ...Object.values(SEED.approvalRuns)].sort(),
    );
  });

  it("gives the user-held run its controller's user id, and no other run one", async () => {
    const rows = await handle!.sql<{ id: string; control_user_id: string | null }[]>`
      select id, control_user_id from runs where controller = 'user' or control_user_id is not null`;
    expect(rows).toEqual([{ id: SEED.runs.takeover, control_user_id: ownerId }]);
  });

  it("leases browser-1 to the live run on both sides", async () => {
    const [slot] = await handle!.sql<{ run_id: string; state: string }[]>`
      select run_id, state from browser_slots where name = 'browser-1'`;
    expect(slot).toEqual({ run_id: SEED.runs.live, state: "leased" });
  });

  it("stores events and approvals that parse with their contracts", async () => {
    const events = await handle!.sql<{ payload: unknown }[]>`select payload from run_events`;
    expect(events.length).toBeGreaterThan(20);
    for (const { payload } of events) RunEvent.parse(payload);
    const pending = await handle!.sql<{ kind: string; request: unknown }[]>`
      select kind, request from approvals where status = 'pending'`;
    expect(pending.map((p) => p.kind).sort()).toEqual([...APPROVAL_KINDS].sort());
    for (const { request } of pending) ApprovalRequest.parse(request);
  });

  it("records the bypass decision as bypass, never as a person (D44)", async () => {
    const [row] = await handle!.sql<{ decided_by: string; status: string }[]>`
      select decided_by, status from approvals where id = ${SEED.approvals.bypassed}`;
    expect(row).toEqual({ decided_by: "bypass", status: "approved" });
  });
});
