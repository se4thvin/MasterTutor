import { createDb, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "./auth.ts";

let testDb: TestDatabase;
let handle: DbHandle;
const baseURL = "http://localhost:3000";
const secret = "test-better-auth-secret-0123456789abcdef";

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1", "browser-2"] });
  handle = createDb(testDb.webUrl, { max: 4 });
});
afterAll(async () => {
  await handle?.close();
  await testDb?.stop();
});

function signUp(signupOpen: boolean, email: string) {
  const auth = createAuth({ db: handle.db, secret, baseURL, signupOpen });
  return auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery-staple", name: "Test" },
  });
}

describe("Better Auth wiring", () => {
  it("lets exactly one of two simultaneous first sign-ups win; the other gets 403", async () => {
    const results = await Promise.allSettled([
      signUp(false, "racer-a@example.test"),
      signUp(false, "racer-b@example.test"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ status: "FORBIDDEN" });
    const users = await handle.sql`select count(*)::int as n from "user"`;
    const workspaces = await handle.sql`select count(*)::int as n from workspaces`;
    const owners =
      await handle.sql`select count(*)::int as n from workspace_members where role = 'owner'`;
    const members = await handle.sql`select count(*)::int as n from workspace_members`;
    expect([users[0]?.n, workspaces[0]?.n, owners[0]?.n, members[0]?.n]).toEqual([1, 1, 1, 1]);
  });

  it("made the winner the workspace owner with slot-clamped concurrency", async () => {
    const rows = await handle.sql`
      select wm.role, s.concurrency from workspace_members wm
      join settings s on s.workspace_id = wm.workspace_id`;
    expect(rows).toEqual([{ role: "owner", concurrency: 2 }]);
  });

  it("keeps sign-up closed after the first user", async () => {
    await expect(signUp(false, "intruder@example.test")).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
    const users = await handle.sql`select count(*)::int as n from "user"`;
    expect(users[0]?.n).toBe(1);
  });

  it("adds later users as members when sign-up is open", async () => {
    const result = await signUp(true, "teammate@example.test");
    const rows =
      await handle.sql`select role from workspace_members where user_id = ${result.user.id}`;
    expect(rows).toEqual([{ role: "member" }]);
  });
});
