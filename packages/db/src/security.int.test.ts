import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;
let web: postgres.Sql;
let agent: postgres.Sql;
let workspaceId: string;
let itemId: string;
let runId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 2, onnotice: () => undefined });
  web = postgres(db.webUrl, { max: 2, onnotice: () => undefined });
  agent = postgres(db.agentUrl, { max: 2, onnotice: () => undefined });
  [{ id: workspaceId }] =
    (await owner`insert into workspaces (name) values ('W') returning id`) as [{ id: string }];
  [{ id: itemId }] = (await owner`
    insert into vault_items (workspace_id, alias, origin, label)
    values (${workspaceId}, 'site', 'https://example.com', 'Site') returning id`) as [
    { id: string },
  ];
  [{ id: runId }] = (await owner`
    insert into runs (workspace_id, goal, allowed_origins)
    values (${workspaceId}, 'goal', ${["https://example.com"]}) returning id`) as [{ id: string }];
  await owner`insert into vault_audit (workspace_id, item_id, alias, action, outcome)
              values (${workspaceId}, ${itemId}, 'site', 'create', 'ok')`;
  await owner`insert into browser_sessions (workspace_id, alias, origin, sealed_state)
              values (${workspaceId}, 'site', 'https://example.com', ${Buffer.from([1])})`;
});
afterAll(async () => {
  await Promise.all([web?.end(), agent?.end(), owner?.end()]);
  await db?.stop();
});

describe("web_role", () => {
  it("cannot read the run transcript", async () => {
    await expect(web`select * from run_transcript`).rejects.toThrow(/permission denied/);
  });
  it("can seal secrets but never read them back", async () => {
    const [row] = await web`insert into vault_secrets (item_id, field, sealed)
                            values (${itemId}, 'password', ${Buffer.from([1, 2, 3])}) returning id`;
    expect(row?.id).toBeTruthy();
    expect(await web`select id, field from vault_secrets`).toHaveLength(1);
    await expect(web`select sealed from vault_secrets`).rejects.toThrow(/permission denied/);
  });
  it("can submit OTP codes but not read them", async () => {
    await web`insert into otp_codes (run_id, sealed) values (${runId}, ${Buffer.from([9])})`;
    await expect(web`select sealed from otp_codes`).rejects.toThrow(/permission denied/);
  });
  it("can list and forget browser sessions without reading their state", async () => {
    expect(await web`select alias, origin from browser_sessions`).toHaveLength(1);
    await expect(web`select sealed_state from browser_sessions`).rejects.toThrow(
      /permission denied/,
    );
  });
  it("cannot select any bytea column in the schema", async () => {
    const columns = await owner<
      { table_schema: string; table_name: string; column_name: string }[]
    >`
      select table_schema, table_name, column_name from information_schema.columns
      where data_type = 'bytea' and table_schema not in ('pg_catalog', 'information_schema')`;
    expect(columns.length).toBeGreaterThan(0);
    for (const c of columns) {
      await expect(
        web.unsafe(`select "${c.column_name}" from "${c.table_schema}"."${c.table_name}"`),
        `${c.table_name}.${c.column_name}`,
      ).rejects.toThrow(/permission denied/);
    }
  });
  it("cannot create tables", async () => {
    await expect(web`create table sneaky (a int)`).rejects.toThrow(/permission denied/);
  });

  it("can read vault grants but never write them (S1)", async () => {
    await agent`insert into vault_grants (item_id, origin, approved_by)
                values (${itemId}, 'https://example.com', 'u-1')`;
    expect(await web`select approved_by from vault_grants where item_id = ${itemId}`).toHaveLength(
      1,
    );
    await expect(
      web`insert into vault_grants (item_id, origin, approved_by) values (${itemId}, 'https://b.example', 'x')`,
    ).rejects.toThrow(/permission denied/);
    await expect(web`update vault_grants set approved_by = 'x'`).rejects.toThrow(
      /permission denied/,
    );
    await expect(web`delete from vault_grants`).rejects.toThrow(/permission denied/);
  });
});

describe("agent_role", () => {
  it("cannot touch auth tables", async () => {
    for (const table of ["user", "session", "account", "verification"]) {
      await expect(agent.unsafe(`select * from "${table}"`)).rejects.toThrow(/permission denied/);
    }
  });
  it("sees only who has an unexpired session, never a session token (live revocation)", async () => {
    await agent`select user_id, expires_at from "session"`;
    await expect(agent`select token from "session"`).rejects.toThrow(/permission denied/);
  });
  it("can read transcripts and sealed values", async () => {
    await agent`select * from run_transcript`;
    await agent`select sealed from vault_secrets`;
  });
});

describe("vault_audit is append-only", () => {
  it("rejects update and delete from both service roles", async () => {
    for (const client of [web, agent]) {
      await client`insert into vault_audit (workspace_id, alias, action, outcome)
                   values (${workspaceId}, 'site', 'fill', 'ok')`;
      await expect(client`update vault_audit set outcome = 'x'`).rejects.toThrow(
        /permission denied/,
      );
      await expect(client`delete from vault_audit`).rejects.toThrow(/permission denied/);
    }
  });
  it("rejects update, delete and truncate even from the owner", async () => {
    await expect(owner`update vault_audit set outcome = 'x'`).rejects.toThrow(/append-only/);
    await expect(owner`delete from vault_audit`).rejects.toThrow(/append-only/);
    await expect(owner`truncate vault_audit`).rejects.toThrow(/append-only/);
  });
  it("does not block deleting the vault item it describes", async () => {
    await owner`delete from vault_items where id = ${itemId}`;
    const rows = await owner`select count(*)::int as n from vault_audit where item_id = ${itemId}`;
    expect(rows[0]?.n).toBe(1);
  });
});
