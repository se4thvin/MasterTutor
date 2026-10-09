import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;
beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
});
afterAll(async () => {
  await owner?.end();
  await db?.stop();
});

const journal = JSON.parse(
  readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("tool_profiles migration (journal order, never a hard-coded number: P10a-1)", () => {
  it("is exactly one migration, named by its index and ordered after every earlier one", () => {
    const named = journal.entries.filter((entry) => entry.tag.endsWith("_tool_profiles"));
    expect(named).toHaveLength(1);
    const mine = named[0]!;
    expect(mine.tag).toBe(`${String(mine.idx).padStart(4, "0")}_tool_profiles`);
    const earlier = journal.entries.filter((entry) => entry.idx < mine.idx);
    expect(earlier.length).toBeGreaterThan(0);
    // The migrator applies by `when`, so every earlier migration must also be earlier in time.
    for (const entry of earlier) expect(entry.when).toBeLessThan(mine.when);
  });

  it("a fresh database applies every journal migration, in journal order", async () => {
    const applied = await owner<{ created_at: string }[]>`
      select created_at from drizzle.__drizzle_migrations order by id`;
    expect(applied.map((row) => Number(row.created_at))).toEqual(
      [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.when),
    );
  });

  it("adds tool_profile with a browser_use default and takeovers with 0", async () => {
    const rows = await owner<
      { table_name: string; column_name: string; column_default: string; is_nullable: string }[]
    >`
      select table_name, column_name, column_default, is_nullable from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (('runs','tool_profile'),('benchmarks','tool_profile'),('benchmark_runs','takeovers'))
      order by table_name, column_name`;
    expect(
      rows.map((r) => `${r.table_name}.${r.column_name}=${r.column_default} null:${r.is_nullable}`),
    ).toEqual([
      "benchmark_runs.takeovers=0 null:NO",
      "benchmarks.tool_profile='browser_use'::tool_profile null:NO",
      "runs.tool_profile='browser_use'::tool_profile null:NO",
    ]);
  });

  it("allows exactly the contract's profiles", async () => {
    const [row] = await owner<{ labels: string[] }[]>`
      select array_agg(enumlabel order by enumsortorder) as labels from pg_enum e
      join pg_type t on t.oid = e.enumtypid where t.typname = 'tool_profile'`;
    expect(row?.labels).toEqual(["browser_use", "computer_use"]);
  });
});
