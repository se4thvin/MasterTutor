import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.ts";
import { startTestDatabase, TEST_ROLE_PASSWORDS, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  db = await startTestDatabase({ slots: ["browser-1", "browser-2", "browser-3"] });
  owner = postgres(db.ownerUrl, { max: 2, onnotice: () => undefined });
});
afterAll(async () => {
  await owner?.end();
  await db?.stop();
});

describe("runMigrations", () => {
  it("creates all 28 tables and the vector extension", async () => {
    const tables =
      await owner`select count(*)::int as n from pg_tables where schemaname = 'public'`;
    expect(tables[0]?.n).toBe(28);
    const ext = await owner`select extname from pg_extension where extname = 'vector'`;
    expect(ext).toHaveLength(1);
  });

  it("is idempotent and syncs slot rows to the configured list", async () => {
    await runMigrations({
      databaseUrl: db.ownerUrl,
      webPassword: TEST_ROLE_PASSWORDS.web,
      agentPassword: TEST_ROLE_PASSWORDS.agent,
      slots: ["browser-1", "browser-2"],
    });
    const rows = await owner`select name, state from browser_slots order by name`;
    expect(rows).toEqual([
      { name: "browser-1", state: "restarting" },
      { name: "browser-2", state: "restarting" },
    ]);
  });

  it("lets both service roles log in", async () => {
    for (const [url, role] of [
      [db.webUrl, "web_role"],
      [db.agentUrl, "agent_role"],
    ] as const) {
      const client = postgres(url, { max: 1 });
      const [row] = await client`select current_user as name`;
      expect(row?.name).toBe(role);
      await client.end();
    }
  });

  it("refuses role passwords that could escape the ALTER ROLE literal", async () => {
    await expect(
      runMigrations({
        databaseUrl: db.ownerUrl,
        webPassword: "x'; drop table runs; --aaaaaaaaaaa",
        agentPassword: TEST_ROLE_PASSWORDS.agent,
        slots: ["browser-1"],
      }),
    ).rejects.toThrow();
  });
});
