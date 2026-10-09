import { RESERVED_DECIDERS } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.ts";
import { createVaultItem } from "./queries/vault.ts";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "./testing.ts";

let database: TestDatabase;
let owner: DbHandle;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
}, 300_000);
afterAll(async () => {
  await owner?.close();
  await database?.stop();
});

let counter = 0;
async function newRunAndItem() {
  const { workspaceId, userId } = await seedMember(owner.db);
  const runId = await seedRun(owner.db, { workspaceId });
  const alias = `decider-${++counter}`;
  const { id: itemId } = await createVaultItem(owner.db, {
    workspaceId,
    alias,
    origin: "https://x.test",
    label: alias,
    imap: null,
    secrets: [],
    actor: userId,
  });
  return { runId, itemId, userId };
}

describe("decider CHECKs (spec §4, migration 0015)", () => {
  it("refuses every machine decider as a lasting vault grant", async () => {
    const { itemId } = await newRunAndItem();
    for (const decider of [...RESERVED_DECIDERS, "Observer", "POLICY"])
      await expect(
        owner.sql`insert into vault_grants (item_id, origin, approved_by) values (${itemId}, ${`https://${decider}.test`}, ${decider})`,
        decider,
      ).rejects.toThrow(/vault_grants_human_approver/);
  });

  it("refuses a well-shaped approver who is not a real user (FK, D52)", async () => {
    const { itemId } = await newRunAndItem();
    await expect(
      owner.sql`insert into vault_grants (item_id, origin, approved_by) values (${itemId}, 'https://ghost.test', 'ghost-user')`,
    ).rejects.toThrow(/vault_grants_approved_by_user_id_fk/);
  });

  it("drops a grant when its approver's account is deleted", async () => {
    const { itemId, userId } = await newRunAndItem();
    await owner.sql`insert into vault_grants (item_id, origin, approved_by) values (${itemId}, 'https://gone.test', ${userId})`;
    await owner.sql`delete from "user" where id = ${userId}`;
    expect(await owner.sql`select 1 from vault_grants where approved_by = ${userId}`).toHaveLength(
      0,
    );
  });

  it("accepts a user id as a grant approver", async () => {
    const { itemId, userId } = await newRunAndItem();
    await owner.sql`insert into vault_grants (item_id, origin, approved_by) values (${itemId}, 'https://ok.test', ${userId})`;
  });

  it("refuses a decided_by that is not a decider shape", async () => {
    const { runId } = await newRunAndItem();
    await expect(
      owner.sql`insert into approvals (run_id, step_seq, kind, request, status, decided_by)
        values (${runId}, 1, 'budget', '{}'::jsonb, 'approved', 'user 1; drop')`,
    ).rejects.toThrow(/approvals_decided_by_ck/);
    await owner.sql`insert into approvals (run_id, step_seq, kind, request, status, decided_by)
      values (${runId}, 2, 'budget', '{}'::jsonb, 'approved', 'observer')`;
  });
});
