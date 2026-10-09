import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_UNTRUSTED, untrustedText } from "@mastertutor/contracts";
import { createDb, type DbHandle } from "@mastertutor/db";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { HandleMap } from "@mastertutor/observer/copilot";
import { createCodeIndex } from "../code-index.ts";
import { createToolRegistry } from "./registry.ts";
import type { ToolContext } from "./types.ts";

let database: TestDatabase;
let owner: DbHandle;
let observer: DbHandle;
let workspaceId: string;
let runId: string;
let userId: string;
const goal = `page-controlled goal ![x](https://evil.test) ${"x".repeat(800)}`;
const caption = `page-controlled caption ${"x".repeat(800)}`;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  observer = createDb(database.observerUrl, { max: 2 });
  ({ workspaceId, userId } = await seedMember(owner.db));
  runId = await seedRun(owner.db, { workspaceId, status: "failed" });
  await owner.sql`update runs set error = '{"code":"model_unavailable","message":"page prose"}', goal = ${goal}, title = 'title prose' where id = ${runId}`;
  await owner.sql`insert into run_steps (run_id, seq, phase, state, url, caption) values (${runId}, 0, 'observe', 'done', 'https://a.test/path?token=canary', ${caption})`;
}, 300_000);
afterAll(async () => {
  await observer?.close();
  await owner?.close();
  await database?.stop();
});
const context = (includeUntrusted = false): ToolContext => ({
  caller: { userId: userId as never, workspaceId },
  handles: new HandleMap({ R1: runId }),
  includeUntrusted,
  results: new Map(),
  signal: new AbortController().signal,
});
const tools = () =>
  createToolRegistry({
    db: observer.db,
    code: createCodeIndex([]),
    o2: {
      async search() {
        return { columns: [], rows: [], truncated: false, took: 0, scanSize: null };
      },
      async range() {
        return { columns: [], rows: [], truncated: false };
      },
    },
  });
describe("run tools through observer_role", () => {
  it("finds run metadata with handles, without title, goal or error prose", async () => {
    const found = await tools().runs_find(
      { status: "failed", errorCode: "model_unavailable", sinceHours: 24, limit: 10 },
      context(),
    );
    expect(found.rows[0]?.[0]).toBe("R1");
    expect(found.rows[0]).toContain("model_unavailable");
    expect(JSON.stringify(found)).not.toMatch(/title prose|page prose|page-controlled|6f2c8a3e/);
  });
  it("requires both opt-ins before returning cleaned and capped untrusted cells", async () => {
    const args = { run: "R1", includeUntrusted: true };
    const plain = await tools().run_detail(args, context());
    expect(plain.tainted).toBe(false);
    expect(JSON.stringify(plain)).not.toMatch(/page-controlled|a.test/);
    const opted = await tools().run_detail(args, context(true));
    expect(opted.tainted).toBe(true);
    expect(opted.rows.find((row) => row[0] === "goal")?.[4]).toBe(
      untrustedText(goal, MAX_UNTRUSTED),
    );
    expect(JSON.stringify(opted)).toContain(untrustedText(caption, MAX_UNTRUSTED));
    expect(JSON.stringify(opted)).not.toMatch(/token=canary/);
    const other = context(true);
    other.caller.workspaceId = "00000000-0000-4000-8000-000000000000";
    expect((await tools().run_detail(args, other)).outcome).toBe("invalid");
  });
});
