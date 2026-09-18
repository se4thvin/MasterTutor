import { approvals, createDb, runSteps, type DbHandle } from "@mastertutor/db";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  approvalScreenshotResponse,
  stepScreenshotResponse,
  type ScreenshotDeps,
} from "./screenshots.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let tdb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let userId: string;
let runId: string;
let otherRun: string;
let shotApproval: string;
let originApproval: string;
let foreignApproval: string;
const fetched: string[] = [];

const deps = (viewer: string | null = userId): ScreenshotDeps => ({
  db: web.db,
  storage: {
    getStream: async (key: string) => {
      fetched.push(key);
      return new Blob([PNG]).stream();
    },
  },
  viewerId: async () => viewer,
});
const step = (run: string, seq: string, headers: HeadersInit = {}, viewer?: string | null) =>
  stepScreenshotResponse(deps(viewer), new Request(`http://web.test/x`, { headers }), run, seq);
const approvalShot = (run: string, approval: string) =>
  approvalScreenshotResponse(deps(), new Request("http://web.test/x"), run, approval);

beforeAll(async () => {
  tdb = await startTestDatabase();
  owner = createDb(tdb.ownerUrl, { max: 2 });
  web = createDb(tdb.webUrl, { max: 2 });
  const member = await seedMember(owner.db);
  userId = member.userId;
  runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
  otherRun = await seedRun(owner.db, { workspaceId: member.workspaceId });
  const key = `runs/${runId}/steps/1-abc123.png`;
  await owner.db.insert(runSteps).values([
    { runId, seq: 1, phase: "observe", state: "done", screenshotKey: key },
    { runId, seq: 2, phase: "observe", state: "done", screenshotKey: null },
    {
      runId,
      seq: 3,
      phase: "observe",
      state: "done",
      screenshotKey: `runs/${otherRun}/steps/3-zz.png`,
    },
  ]);
  const inserted = await owner.db
    .insert(approvals)
    .values([
      {
        runId,
        stepSeq: 1,
        kind: "risky_click",
        request: {
          kind: "risky_click",
          action: { type: "click", x: 1, y: 1, button: "left" },
          label: "Delete",
          url: "https://example.com/",
          screenshotKey: key,
        },
      },
      {
        runId,
        stepSeq: 2,
        kind: "new_origin",
        request: {
          kind: "new_origin",
          origin: "https://other.example",
          url: "https://other.example/",
        },
      },
      {
        runId: otherRun,
        stepSeq: 1,
        kind: "risky_click",
        request: {
          kind: "risky_click",
          action: { type: "click", x: 1, y: 1, button: "left" },
          label: "Send",
          url: "https://example.com/",
          screenshotKey: `runs/${otherRun}/steps/1-q.png`,
        },
      },
    ])
    .returning({ id: approvals.id });
  [shotApproval, originApproval, foreignApproval] = inserted.map((r) => r.id) as [
    string,
    string,
    string,
  ];
});
beforeEach(() => {
  fetched.length = 0;
});
afterAll(async () => {
  await Promise.all([web?.close(), owner?.close()]);
  await tdb?.stop();
});

describe("step and approval screenshots (Task 0D, D6, D7)", () => {
  it("serves a member's step screenshot by seq, inert and never cached", async () => {
    const res = await step(runId, "1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // Masked screenshots never stay in a disk cache after sign-out (coordinator ruling).
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(fetched).toEqual([`runs/${runId}/steps/1-abc123.png`]);
    const etag = res.headers.get("etag")!;
    expect(etag).not.toContain("abc123");
    expect((await step(runId, "1", { "if-none-match": etag })).status).toBe(304);
  });

  it("refuses without a session, for strangers, bad seqs, missing keys and keys of another run", async () => {
    const unauthenticated = await step(runId, "1", {}, null);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("cache-control")).toBe("private, no-store");
    const stranger = await seedMember(owner.db);
    const hidden = await step(runId, "1", {}, stranger.userId);
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("cache-control")).toBe("private, no-store");
    for (const seq of ["-1", "01", "1.5", "99999999999", "x"])
      expect((await step(runId, seq)).status).toBe(404);
    expect((await step("not-a-uuid", "1")).status).toBe(404);
    expect((await step(runId, "2")).status).toBe(404);
    expect((await step(runId, "3")).status).toBe(404);
    expect((await step(runId, "9")).status).toBe(404);
    expect(fetched).toEqual([]);
  });

  it("serves the screenshot an approval was requested on, and nothing else", async () => {
    const res = await approvalShot(runId, shotApproval);
    expect(res.status).toBe(200);
    expect(fetched).toEqual([`runs/${runId}/steps/1-abc123.png`]);
    expect((await approvalShot(runId, originApproval)).status).toBe(404);
    expect((await approvalShot(runId, foreignApproval)).status).toBe(404);
    expect((await approvalShot(otherRun, shotApproval)).status).toBe(404);
  });
});
