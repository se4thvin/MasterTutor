import { createDb, runEvents, runSteps, runTranscript, runs, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LeaseLost, RunChanged } from "../runtime/errors.ts";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { NO_SESSION_STORE, StepStore, type SessionStore } from "./step-store.ts";
import { GARAGE_REF, lastUserEventId, loadTranscript, unansweredCalls } from "./transcript.ts";

let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let workspaceId: string;
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl);
  agent = createDb(database.agentUrl);
  workspaceId = await seedWorkspace(owner.db);
});
afterAll(async () => {
  await agent?.close();
  await owner?.close();
  await database?.stop();
});

async function open(sessionStore: SessionStore = NO_SESSION_STORE) {
  const run = await insertRun(owner.db, { workspaceId, status: "running", leaseOwner: "me" });
  const storage = createMemoryStorage();
  const store = await StepStore.open({ db: agent.db, storage, sessionStore, owner: "me", run });
  return { run, storage, store };
}

describe("StepStore.commit (spec §5.3)", () => {
  it("writes step, transcript (images to storage), run fields and events in one transaction", async () => {
    const { run, storage, store } = await open();
    const seq = store.nextSeq();
    await store.commit({
      steps: [
        {
          seq,
          phase: "decide",
          state: "done",
          caption: "Reading",
          action: { tool: "computer", summary: "click (1, 2)", point: { x: 1, y: 2 } },
        },
      ],
      transcript: [
        {
          dir: "in",
          item: {
            type: "computer_call_output",
            call_id: "c0",
            output: { type: "computer_screenshot", image_url: PNG },
          },
          responseId: null,
          userEventId: "7",
        },
        {
          dir: "out",
          item: {
            type: "computer_call",
            call_id: "c1",
            actions: [{ type: "wait" }],
            pending_safety_checks: [],
          },
          responseId: "resp_1",
          userEventId: null,
        },
      ],
      run: { previousResponseId: "resp_1", currentUrl: "http://site.fixtures.test/" },
    });
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, run.id));
    expect(row).toMatchObject({
      previousResponseId: "resp_1",
      currentUrl: "http://site.fixtures.test/",
    });
    const transcript = await loadTranscript(agent.db, run.id);
    const image = (transcript[0]!.item.output as { image_url: string }).image_url;
    expect(image.startsWith(GARAGE_REF)).toBe(true);
    expect(storage.objects.has(image.slice(GARAGE_REF.length))).toBe(true);
    expect(unansweredCalls(transcript).map((call) => call.callId)).toEqual(["c1"]);
    expect(lastUserEventId(transcript)).toBe("7");
    const events = await owner.db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(events.map((event) => event.type)).toEqual(["step"]);
  });

  it("rejects everything when the lease is lost", async () => {
    const { run, store } = await open();
    await owner.db.update(runs).set({ leaseOwner: "other" }).where(eq(runs.id, run.id));
    await expect(
      store.commit({ steps: [{ seq: store.nextSeq(), phase: "observe", state: "done" }] }),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect(await owner.db.select().from(runSteps).where(eq(runSteps.runId, run.id))).toEqual([]);
  });

  it("guards transitions by status and emits a status event", async () => {
    const { run, store } = await open();
    await store.commit({
      transition: { from: ["running"], to: "waiting", waitReason: "captcha", reason: "captcha" },
    });
    await expect(
      store.commit({
        transition: { from: ["running"], to: "completed", waitReason: null, reason: null },
      }),
    ).rejects.toBeInstanceOf(RunChanged);
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, run.id));
    expect(row).toMatchObject({ status: "waiting", waitReason: "captcha" });
    expect(
      (await owner.db.select().from(runEvents).where(eq(runEvents.runId, run.id))).map(
        (e) => e.type,
      ),
    ).toEqual(["status"]);
  });

  it("saves session state inside the transaction and rolls back with it", async () => {
    const saved: string[] = [];
    const { run, store } = await open({
      load: async () => null,
      save: async () => {
        saved.push("x");
        throw new Error("seal failed");
      },
    });
    await expect(
      store.commit({
        steps: [{ seq: store.nextSeq(), phase: "act", state: "done" }],
        run: { currentUrl: "http://rolled.back/" },
        storage: { cookies: [], origins: [] },
      }),
    ).rejects.toThrow("seal failed");
    expect(saved).toEqual(["x"]);
    expect(await owner.db.select().from(runSteps).where(eq(runSteps.runId, run.id))).toEqual([]);
    expect(await owner.db.select().from(runEvents).where(eq(runEvents.runId, run.id))).toEqual([]);
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, run.id));
    expect(row?.currentUrl).not.toBe("http://rolled.back/");
  });

  it("releases the lease and stamps finished_at on terminal transitions", async () => {
    const { run, store } = await open();
    await store.commit({
      transition: { from: ["running"], to: "completed", waitReason: null, reason: null },
      run: { releaseLease: true },
    });
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, run.id));
    expect(row?.leaseOwner).toBeNull();
    expect(row?.finishedAt).not.toBeNull();
    expect(
      await owner.db.select().from(runTranscript).where(eq(runTranscript.runId, run.id)),
    ).toEqual([]);
  });

  it("uploads nothing that survives a lost lease and never overwrites a live owner's image", async () => {
    const { run, store, storage } = await open();
    const liveKey = `runs/${run.id}/transcript/0-0.png`;
    await storage.put(liveKey, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
    await owner.db.update(runs).set({ leaseOwner: "other" }).where(eq(runs.id, run.id));
    await expect(
      store.commit({
        transcript: [
          {
            dir: "in",
            item: {
              type: "computer_call_output",
              call_id: "c0",
              output: { type: "computer_screenshot", image_url: PNG },
            },
            responseId: null,
            userEventId: null,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect([...storage.objects.keys()]).toEqual([liveKey]);
    expect([...storage.objects.get(liveKey)!]).toEqual([1, 2, 3]);
    expect(
      await owner.db.select().from(runTranscript).where(eq(runTranscript.runId, run.id)),
    ).toEqual([]);
  });

  it("completes a started step row with caption, url, screenshot and usage", async () => {
    const { run, store } = await open();
    const seq = store.nextSeq();
    await store.commit({ steps: [{ seq, phase: "act", state: "started" }] });
    const usage = {
      steps: 1,
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      usd: 0.1,
      activeMs: 0,
    };
    await store.commit({
      steps: [
        {
          seq,
          phase: "act",
          state: "done",
          caption: "Clicked",
          url: "http://a.test/",
          screenshotKey: `runs/${run.id}/steps/${seq}.png`,
          usage,
        },
      ],
    });
    await store.commit({ steps: [{ seq, phase: "act", state: "done" }] });
    const [row] = await owner.db.select().from(runSteps).where(eq(runSteps.runId, run.id));
    expect(row).toMatchObject({
      state: "done",
      caption: "Clicked",
      url: "http://a.test/",
      screenshotKey: `runs/${run.id}/steps/${seq}.png`,
      usage,
    });
  });

  it("fails loudly on an unparseable transcript row", async () => {
    const { run } = await open();
    await owner.db.insert(runTranscript).values({ runId: run.id, seq: 0, item: { garbage: true } });
    await expect(loadTranscript(agent.db, run.id)).rejects.toThrow(/unparseable/);
  });
});
