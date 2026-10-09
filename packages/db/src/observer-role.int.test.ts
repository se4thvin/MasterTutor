import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.ts";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

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

const VIEWS = [
  "runs",
  "run_goals",
  "run_steps",
  "approvals",
  "run_events",
  "guard_reviews",
  "browser_slots",
  "downloads",
  "alerts",
];
const COPILOT_TABLES = ["copilot_threads", "copilot_items", "copilot_results", "copilot_spend"];

describe("observer_role reaches only schema observer (spec §7.3)", () => {
  it("has no privilege on any table outside schema observer", async () => {
    const rows = await owner.sql<{ schema: string; name: string; priv: string }[]>`
      select n.nspname as schema, c.relname as name, p.priv
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
      where c.relkind in ('r','v','m','p','f') and n.nspname not in ('pg_catalog','information_schema')
        and has_table_privilege('observer_role', c.oid, p.priv)`;
    for (const row of rows)
      expect(row.schema, `${row.schema}.${row.name} ${row.priv}`).toBe("observer");
    const reads = rows
      .filter((row) => row.priv === "SELECT")
      .map((row) => row.name)
      .sort();
    expect(reads).toEqual([...VIEWS, ...COPILOT_TABLES].sort());
    const writes = new Set(rows.filter((row) => row.priv !== "SELECT").map((row) => row.name));
    for (const view of VIEWS) expect(writes.has(view), view).toBe(false);
  });

  it("never exposes goal text, transcripts, request bodies or the Guard's input in the general views", async () => {
    const columns = await owner.sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns where table_schema = 'observer'`;
    const of = (table: string) =>
      columns.filter((c) => c.table_name === table).map((c) => c.column_name);
    expect(of("runs")).not.toContain("goal");
    expect(of("approvals")).not.toContain("request");
    expect(of("approvals")).not.toContain("decided_by");
    expect(of("run_events")).not.toContain("payload");
    expect(of("guard_reviews")).not.toContain("input");
    expect(of("run_steps")).not.toContain("url");
    expect(of("run_steps")).not.toContain("result");
  });

  it("logs in with its own password and cannot read public tables", async () => {
    const observer = createDb(database.observerUrl, { max: 1 });
    try {
      await expect(observer.sql`select 1 from public.runs limit 1`).rejects.toThrow(
        /permission denied/,
      );
      await expect(observer.sql`select 1 from public.vault_secrets limit 1`).rejects.toThrow(
        /permission denied/,
      );
      await observer.sql`select count(*) from observer.runs`;
    } finally {
      await observer.close();
    }
  });

  it("gives web and agent nothing in schema observer, and keeps guard_reviews from web", async () => {
    for (const role of ["web_role", "agent_role"]) {
      const [row] = await owner.sql<{ n: number }[]>`
        select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'observer' and has_table_privilege(${role}, c.oid, 'SELECT')`;
      expect(row!.n, role).toBe(0);
    }
    const [web] = await owner.sql<
      { ok: boolean }[]
    >`select has_table_privilege('web_role', 'public.guard_reviews', 'SELECT') as ok`;
    expect(web!.ok).toBe(false);
    const [agent] = await owner.sql<
      { ok: boolean }[]
    >`select has_table_privilege('agent_role', 'public.guard_reviews', 'INSERT') as ok`;
    expect(agent!.ok).toBe(true);
  });
});
