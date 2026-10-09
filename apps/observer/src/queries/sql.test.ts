import { describe, expect, it } from "vitest";
import { checkSql } from "./sql.ts";

describe("the SQL structural guard (spec §7.4)", () => {
  it("accepts a single SELECT on the named stream", () => {
    expect(
      checkSql(
        `SELECT _timestamp, body FROM "mastertutor" WHERE severity = 'ERROR'`,
        "mastertutor",
      ),
    ).toEqual({ ok: true });
    expect(
      checkSql(`WITH e AS (SELECT * FROM "default") SELECT count(*) FROM e`, "default").ok,
    ).toBe(false);
  });
  it("refuses another stream, a join, several statements, comments and writes", () => {
    for (const sql of [
      `SELECT * FROM "containers"`,
      `SELECT * FROM "mastertutor" JOIN "containers" ON true`,
      `SELECT 1 FROM "mastertutor"; DELETE FROM "mastertutor"`,
      `SELECT 1 FROM "mastertutor" -- ignore`,
      `DELETE FROM "mastertutor"`,
      `SELECT * FROM "mastertutor" WHERE body = 'a'; DROP TABLE x`,
    ])
      expect(checkSql(sql, "mastertutor").ok, sql).toBe(false);
  });
  it("ignores keywords inside string literals", () => {
    expect(
      checkSql(`SELECT * FROM "mastertutor" WHERE body LIKE '%delete from x;%'`, "mastertutor"),
    ).toEqual({ ok: true });
  });
});

it("refuses comma sources, qualified sources, subqueries and unions", () => {
  for (const sql of [
    'SELECT * FROM "mastertutor", "containers"',
    'SELECT * FROM "mastertutor"."containers"',
    'SELECT * FROM "mastertutor" UNION SELECT * FROM "containers"',
    'SELECT (SELECT body FROM "containers") FROM "mastertutor"',
  ])
    expect(checkSql(sql, "mastertutor").ok, sql).toBe(false);
});
