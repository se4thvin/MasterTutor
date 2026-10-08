import { createDb, objectDeletions, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testLogger } from "../testing/notes.ts";
import { sweepObjectDeletions } from "./object-sweep.ts";

let tdb: TestDatabase;
let h: DbHandle;
beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1"] });
  h = createDb(tdb.agentUrl);
});
afterAll(async () => {
  await h?.close();
  await tdb?.stop();
});

const queued = async () =>
  (await h.db.select({ key: objectDeletions.key }).from(objectDeletions)).map((r) => r.key).sort();

describe("sweepObjectDeletions (a deleted note's objects)", () => {
  it("deletes queued objects, keeps a key whose delete failed, and retries it on the next sweep", async () => {
    await h.db.insert(objectDeletions).values([{ key: "assets/a" }, { key: "assets/b" }]);
    const deleted: string[] = [];
    const flaky = {
      delete: async (key: string) => {
        if (key === "assets/b") throw new Error("garage unavailable");
        deleted.push(key);
      },
    };
    expect(await sweepObjectDeletions(h.db, flaky, testLogger)).toBe(1);
    expect(deleted).toEqual(["assets/a"]);
    expect(await queued()).toEqual(["assets/b"]);
    const working = { delete: async (key: string) => void deleted.push(key) };
    expect(await sweepObjectDeletions(h.db, working, testLogger)).toBe(1);
    expect(await queued()).toEqual([]);
    expect(deleted).toEqual(["assets/a", "assets/b"]);
  });
});
