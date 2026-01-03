import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.ts";
import { getMaxConcurrency } from "./queries/settings.ts";
import { listBrowserSlots } from "./queries/slots.ts";
import { ensureWorkspaceMember, hasAnyUser } from "./queries/workspace.ts";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;
let web: DbHandle;
let agent: DbHandle;

beforeAll(async () => {
  db = await startTestDatabase({ slots: ["browser-1", "browser-2"] });
  owner = postgres(db.ownerUrl, { max: 2, onnotice: () => undefined });
  web = createDb(db.webUrl, { max: 4 });
  agent = createDb(db.agentUrl, { max: 2 });
});
afterAll(async () => {
  await Promise.all([web?.close(), agent?.close(), owner?.end()]);
  await db?.stop();
});

async function createUser(id: string): Promise<void> {
  await owner`insert into "user" (id, name, email) values (${id}, 'U', ${`${id}@example.test`})`;
}

describe("workspace bootstrap", () => {
  it("knows when no user exists", async () => {
    expect(await hasAnyUser(web.db)).toBe(false);
  });

  it("creates exactly one owner even when first sign-ups race", async () => {
    await Promise.all(["u1", "u2", "u3"].map(createUser));
    const results = await Promise.all(
      ["u1", "u2", "u3"].map((id) => ensureWorkspaceMember(web.db, id)),
    );
    expect(results.filter((r) => r.role === "owner")).toHaveLength(1);
    expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1);
    const settingsRows = await owner`select concurrency from settings`;
    expect(settingsRows).toEqual([{ concurrency: 2 }]);
    expect(await hasAnyUser(web.db)).toBe(true);
  });

  it("is idempotent per user", async () => {
    const first = await ensureWorkspaceMember(web.db, "u1");
    const again = await ensureWorkspaceMember(web.db, "u1");
    expect(again).toEqual(first);
    const members =
      await owner`select count(*)::int as n from workspace_members where user_id = 'u1'`;
    expect(members[0]?.n).toBe(1);
  });
});

describe("agent-side reads", () => {
  it("reports the highest configured concurrency", async () => {
    expect(await getMaxConcurrency(agent.db)).toBe(2);
    await owner`update settings set concurrency = 7`;
    expect(await getMaxConcurrency(agent.db)).toBe(7);
  });
  it("lists only the requested slots, sorted", async () => {
    expect(await listBrowserSlots(agent.db, ["browser-2", "browser-1", "browser-9"])).toEqual([
      { name: "browser-1", state: "restarting", runId: null },
      { name: "browser-2", state: "restarting", runId: null },
    ]);
  });
});
