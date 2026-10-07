import { RunEventRecord, decodeRunEventData, type RunEvent } from "@mastertutor/contracts";
import { createDb, emitRunEvent, runs, workspaceMembers, type DbHandle } from "@mastertutor/db";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runEventStream } from "./event-stream.ts";

let tdb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let userId: string;
let workspaceId: string;

const emit = (runId: string, event: RunEvent) =>
  web.db.transaction((tx) => emitRunEvent(tx, runId, event));
const status = (value: "running" | "completed"): RunEvent => ({
  type: "status",
  status: value,
  waitReason: null,
  reason: null,
});
const idsIn = (text: string) => [...text.matchAll(/^id: (\d+)$/gm)].map((m) => m[1]);
const recordsIn = (text: string) =>
  [...text.matchAll(/^data: (.*)$/gm)].map((m) => decodeRunEventData(m[1]!));

function open(
  runId: string,
  init: { after?: string; lastEventId?: string; viewer?: string | null; heartbeatMs?: number } = {},
) {
  const abort = new AbortController();
  const query = init.after === undefined ? "" : `?after=${init.after}`;
  const request = new Request(`http://web.test/api/runs/${runId}/events${query}`, {
    headers: init.lastEventId ? { "last-event-id": init.lastEventId } : {},
    signal: abort.signal,
  });
  const viewer = init.viewer === undefined ? userId : init.viewer;
  const response = runEventStream(
    { db: web, viewerId: async () => viewer, heartbeatMs: init.heartbeatMs },
    request,
    runId,
  );
  return { abort, response };
}

/** Reads SSE text until `until` holds or the stream ends; throws after timeoutMs. */
async function read(response: Response, until: (text: string) => boolean, timeoutMs = 5_000) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let ended = false;
  const deadline = Date.now() + timeoutMs;
  while (!until(text)) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`timed out; received:\n${text}`);
    const chunk = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), left)),
    ]);
    if (chunk === null) continue;
    if (chunk.done) {
      ended = true;
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  reader.releaseLock();
  return { text, ended };
}

beforeAll(async () => {
  tdb = await startTestDatabase();
  owner = createDb(tdb.ownerUrl, { max: 2 });
  web = createDb(tdb.webUrl, { max: 4 });
  ({ userId, workspaceId } = await seedMember(owner.db));
});
afterAll(async () => {
  await Promise.all([web?.close(), owner?.close()]);
  await tdb?.stop();
});

describe("GET /api/runs/:id/events (Task 0D)", () => {
  it("refuses malformed or foreign runs, a missing session and bad cursors", async () => {
    const run = await seedRun(owner.db, { workspaceId });
    const stranger = await seedMember(owner.db);
    const foreign = await seedRun(owner.db, { workspaceId: stranger.workspaceId });
    expect((await open("not-a-uuid").response).status).toBe(404);
    expect((await open(foreign).response).status).toBe(404);
    expect((await open(run, { viewer: null }).response).status).toBe(401);
    expect((await open(run, { after: "abc" }).response).status).toBe(400);
    expect((await open(run, { after: "9223372036854775808" }).response).status).toBe(400);
    expect((await open(run, { lastEventId: "9999999999999999999" }).response).status).toBe(400);
  });

  it("replays everything without a cursor in the run_event wire format, then streams live", async () => {
    const run = await seedRun(owner.db, { workspaceId });
    const first = await emit(run, { type: "slot", slotName: "browser-1" });
    const second = await emit(run, status("running"));
    const { abort, response } = open(run);
    const res = await response;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const replay = await read(res, (t) => idsIn(t).length === 2);
    expect(replay.text.startsWith("retry: 2000\n\n")).toBe(true);
    expect(idsIn(replay.text)).toEqual([first, second]);
    expect(replay.text).toContain("\nevent: run_event\n");
    expect(recordsIn(replay.text).map((r) => r?.runId)).toEqual([run, run]);
    const third = await emit(run, { type: "user_message", text: "hello" });
    const live = await read(res, (t) => idsIn(t).includes(third));
    expect(recordsIn(live.text).map((r) => r?.event.type)).toEqual(["user_message"]);
    abort.abort();
  });

  it("resumes after ?after, and Last-Event-ID wins over it", async () => {
    const run = await seedRun(owner.db, { workspaceId });
    const e1 = await emit(run, { type: "slot", slotName: "browser-1" });
    const e2 = await emit(run, { type: "user_message", text: "a" });
    const e3 = await emit(run, { type: "user_message", text: "b" });
    const byQuery = open(run, { after: e1 });
    expect(idsIn((await read(await byQuery.response, (t) => idsIn(t).length === 2)).text)).toEqual([
      e2,
      e3,
    ]);
    byQuery.abort.abort();
    const byHeader = open(run, { after: e1, lastEventId: e2 });
    expect(idsIn((await read(await byHeader.response, (t) => idsIn(t).length === 1)).text)).toEqual(
      [e3],
    );
    byHeader.abort.abort();
  });

  it("ends after a terminal status, and answers 204 when a finished run has nothing new", async () => {
    const run = await seedRun(owner.db, { workspaceId });
    await emit(run, status("running"));
    const { response } = open(run);
    const res = await response;
    await read(res, (t) => idsIn(t).length === 1);
    const terminal = await emit(run, status("completed"));
    await owner.db
      .update(runs)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(runs.id, run));
    const tail = await read(res, () => false);
    expect(tail.ended).toBe(true);
    expect(idsIn(tail.text)).toEqual([terminal]);
    expect((await open(run, { lastEventId: terminal }).response).status).toBe(204);
    const replay = await read(await open(run).response, () => false);
    expect(replay.ended).toBe(true);
    expect(idsIn(replay.text)).toHaveLength(2);
  });

  it("sends heartbeats and skips a stored row the contract cannot read", async () => {
    const run = await seedRun(owner.db, { workspaceId });
    await owner.sql`insert into run_events (run_id, type, payload) values (${run}, 'nope', '{"type":"nope"}'::jsonb)`;
    const good = await emit(run, { type: "user_message", text: "ok" });
    const { abort, response } = open(run, { heartbeatMs: 50 });
    const seen = await read(await response, (t) => t.includes(": ping") && idsIn(t).includes(good));
    expect(idsIn(seen.text)).toEqual([good]);
    abort.abort();
  });

  it("delivers every event in id order when a later id commits first (one run-row lock per writer)", async () => {
    const run = await seedRun(owner.db, { workspaceId });
    await emit(run, { type: "slot", slotName: "browser-1" });
    const { abort, response } = open(run);
    const res = await response;
    await read(res, (t) => idsIn(t).length === 1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let firstId: string | undefined;
    let emitted!: () => void;
    const firstEmitted = new Promise<void>((resolve) => (emitted = resolve));
    // Transaction A takes the earlier id and stays open.
    const first = web.db.transaction(async (tx) => {
      firstId = await emitRunEvent(tx, run, { type: "user_message", text: "earlier" });
      emitted();
      await gate;
    });
    await firstEmitted;
    // Transaction B takes the later id; without the lock it commits while A is still open.
    const second = web.db.transaction((tx) =>
      emitRunEvent(tx, run, { type: "user_message", text: "later" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    const [, secondId] = await Promise.all([first, second]);
    const seen = await read(
      res,
      (t) => idsIn(t).includes(firstId!) && idsIn(t).includes(secondId),
      3_000,
    );
    const order = idsIn(seen.text);
    expect(order.indexOf(firstId!)).toBeLessThan(order.indexOf(secondId));
    abort.abort();
  });

  it("refuses a malformed Last-Event-ID instead of silently replaying", async () => {
    const run = await seedRun(owner.db, { workspaceId });
    expect((await open(run, { lastEventId: "abc" }).response).status).toBe(400);
    expect((await open(run, { lastEventId: "01" }).response).status).toBe(400);
    expect((await open(run, { lastEventId: "12345678901234567890" }).response).status).toBe(400);
  });

  it("enqueues only what the reader asks for (backpressure), then delivers everything", async () => {
    const run = await seedRun(owner.db, { workspaceId });
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await emit(run, { type: "user_message", text: `m${i}` }));
    const enqueue = vi.spyOn(ReadableStreamDefaultController.prototype, "enqueue");
    try {
      const { abort, response } = open(run);
      const res = await response;
      await new Promise((resolve) => setTimeout(resolve, 500));
      // A stalled reader holds at most the retry hint and one record, never the whole log.
      expect(enqueue.mock.calls.length).toBeLessThanOrEqual(2);
      const all = await read(res, (t) => idsIn(t).length === ids.length);
      expect(idsIn(all.text)).toEqual(ids);
      abort.abort();
    } finally {
      enqueue.mockRestore();
    }
  });

  it("closes an open stream on the heartbeat once the viewer is no longer a member", async () => {
    const member = await seedMember(owner.db, { workspaceId, role: "member" });
    const run = await seedRun(owner.db, { workspaceId });
    await emit(run, { type: "user_message", text: "hi" });
    const { response } = open(run, { viewer: member.userId, heartbeatMs: 50 });
    const res = await response;
    await read(res, (t) => idsIn(t).length === 1);
    await owner.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, member.userId),
        ),
      );
    const tail = await read(res, () => false, 3_000);
    expect(tail.ended).toBe(true);
  });

  it("validates each record once on the hot path", async () => {
    const run = await seedRun(owner.db, { workspaceId });
    for (let i = 0; i < 3; i++) await emit(run, { type: "user_message", text: `v${i}` });
    const parse = vi.spyOn(RunEventRecord, "parse");
    const safeParse = vi.spyOn(RunEventRecord, "safeParse");
    try {
      const { abort, response } = open(run);
      await read(await response, (t) => idsIn(t).length === 3);
      abort.abort();
      expect(parse.mock.calls.length + safeParse.mock.calls.length).toBe(3);
    } finally {
      parse.mockRestore();
      safeParse.mockRestore();
    }
  });
});
