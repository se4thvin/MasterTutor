import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeNotify } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import {
  approvals,
  browserSlots,
  createDb,
  runEvents,
  runSteps,
  runs,
  settings,
  type DbHandle,
} from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Scenario } from "../../../../tests/llm-mock/src/scenario.ts";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { createOpenAIModelClient } from "../llm/client.ts";
import { instantClock } from "../runtime/clock.ts";
import type { RuntimeConfig } from "../runtime/config.ts";
import type { BrowserControl } from "../slots/lifecycle.ts";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { FakeLoopBrowser } from "../testing/fake-loop-browser.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { waitFor } from "../testing/wait.ts";
import { Supervisor } from "./supervisor.ts";

const log = createLogger({ service: "test", level: "silent" });
const SLOTS = ["browser-1", "browser-2"];
/** Spec targets are 300 ms (takeover) and 1 s (kill); CI asserts a generous bound on DB timestamps (ruling). */
const CI_BOUND_MS = 2_000;
let database: TestDatabase;
let owner: DbHandle;
let mock: LlmMock;
let workspaceId: string;
let supervisor: Supervisor | undefined;
let downloadsDir: string;
let counter = 0;
const browsers = new Map<string, FakeLoopBrowser>();

/** A slot that "restarts" instantly with a new browser id. */
function fakeControl(): BrowserControl {
  let generation = 0;
  return {
    readBrowserId: async () => `id-${generation}`,
    closeBrowser: async () => void (generation += 1),
  };
}

beforeAll(async () => {
  database = await startTestDatabase({ slots: SLOTS });
  owner = createDb(database.ownerUrl);
  mock = await startLlmMock();
  workspaceId = await seedWorkspace(owner.db);
  downloadsDir = await mkdtemp(join(tmpdir(), "downloads-"));
});
afterEach(async () => {
  await supervisor?.stop();
  supervisor = undefined;
  await owner.db.update(settings).set({ killSwitch: false });
  expect(mock.failures.splice(0)).toEqual([]);
});
afterAll(async () => {
  await mock?.close();
  await owner?.close();
  await database?.stop();
});

const idleSlots = async () =>
  (await owner.db.select().from(browserSlots).where(eq(browserSlots.state, "idle"))).length;

async function start(
  options: { config?: Partial<RuntimeConfig>; control?: BrowserControl } = {},
  clock = instantClock(),
) {
  supervisor = new Supervisor({
    db: createDb(database.agentUrl),
    storage: createMemoryStorage(),
    model: createOpenAIModelClient({ apiKey: "k", baseURL: `${mock.url}/v1` }),
    slots: SLOTS,
    cdpBaseUrl: async (name) => `http://${name}`,
    log,
    testMode: true,
    clock,
    config: {
      heartbeatMs: 200,
      leaseMs: 2_000,
      sweepMs: 300,
      slotPollMs: 5,
      downloadsDir,
      // Tests wait for every slot restart on stop; production bounds it (M1).
      shutdownDrainMs: 30_000,
      ...options.config,
    },
    browserControl: options.control ?? fakeControl(),
    connect: async ({ run }) => {
      const browser = browsers.get(run().id) ?? new FakeLoopBrowser();
      browsers.set(run().id, browser);
      return { browser, close: async () => undefined };
    },
  });
  await supervisor.start();
  await waitFor(async () => (await idleSlots()) === 2, { label: "slots idle" });
}

async function queue(
  turns: Scenario["turns"],
  approvalMode: "ask" | "auto_within_allowlist" = "ask",
  prepare: (browser: FakeLoopBrowser) => void = () => undefined,
) {
  const name = `w${++counter}`;
  mock.setScenarios([{ name, turns }]);
  const run = await insertRun(owner.db, {
    workspaceId,
    goal: `[scenario:${name}] task`,
    approvalMode,
  });
  const browser = new FakeLoopBrowser();
  prepare(browser);
  browsers.set(run.id, browser);
  await owner.sql.notify("run_queued", encodeNotify("run_queued", { runId: run.id }));
  return { run, browser, name };
}
const row = async (id: string) => (await owner.db.select().from(runs).where(eq(runs.id, id)))[0]!;
const until = (id: string, test: (r: Awaited<ReturnType<typeof row>>) => boolean, label: string) =>
  waitFor(async () => test(await row(id)), { label, timeoutMs: 15_000 });
const stepsOf = (id: string) =>
  owner.db.select().from(runSteps).where(eq(runSteps.runId, id)).orderBy(asc(runSteps.seq));
/** The database's own clock, so latency is measured on the same clock as the step rows. */
const dbNow = async () =>
  new Date(String((await owner.sql<Array<{ now: string }>>`select now()::text as now`)[0]!.now));
const done = { outputs: [{ type: "turn" as const, status: "done" as const, reason: "ok" }] };
const click = {
  outputs: [
    { type: "computer" as const, actions: [{ type: "click", x: 10, y: 20, button: "left" }] },
  ],
};
const holdFor = (ms: number) => () => new Promise<void>((resolve) => setTimeout(resolve, ms));
const expectInput = (text: string) => (request: { body: { input?: unknown } }) => {
  if (!JSON.stringify(request.body.input).includes(text)) throw new Error(`no "${text}" in input`);
};
const controlEvents = async (id: string) =>
  (await owner.db.select().from(runEvents).where(eq(runEvents.runId, id))).flatMap((e) =>
    e.payload.type === "control" ? [e.payload.holder] : [],
  );
/** The web's takeControl / handBack (Task 18 web contract). */
async function takeOver(id: string) {
  await owner.db
    .update(runs)
    .set({ controller: "user", status: "waiting", waitReason: "takeover" })
    .where(and(eq(runs.id, id), sql`${runs.status} <> 'sleeping'`));
  await owner.sql.notify("run_control", encodeNotify("run_control", { runId: id }));
}
async function handBackTo(id: string) {
  await owner.db.update(runs).set({ controller: "agent" }).where(eq(runs.id, id));
  await owner.sql.notify("run_control", encodeNotify("run_control", { runId: id }));
}
/** A slot whose browser never comes back with a new id: its restart hangs until the timeout. */
function stuckControl(): BrowserControl {
  return { readBrowserId: async () => "stuck", closeBrowser: async () => undefined };
}

describe("RunWorker + Supervisor", () => {
  it("claims on NOTIFY, completes, and releases: slot_name null, slot recycled, downloads cleared", async () => {
    await start();
    const { run } = await queue([click, done]);
    await mkdir(join(downloadsDir, run.id), { recursive: true });
    await writeFile(join(downloadsDir, run.id, "file.pdf"), "x");
    await until(run.id, (r) => r.status === "completed", "completed");
    await until(run.id, (r) => r.slotName === null && r.leaseOwner === null, "released");
    await waitFor(() => !existsSync(join(downloadsDir, run.id)), { label: "downloads cleared" });
    await waitFor(async () => (await idleSlots()) === 2, { label: "slot recycled" });
  });

  it("sleeps a waiting run (releasing slot and downloads) and wakes it on approval", async () => {
    await start();
    const { run, browser } = await queue([click, done]);
    browser.targets.set("10,20", {
      label: "Delete",
      tag: "button",
      isFormSubmit: false,
      formKind: null,
      isSecretField: false,
      editable: false,
      interactive: true,
    });
    await mkdir(join(downloadsDir, run.id), { recursive: true });
    await writeFile(join(downloadsDir, run.id, "file.pdf"), "x");
    await until(run.id, (r) => r.status === "sleeping" && r.slotName === null, "sleeping");
    await waitFor(() => !existsSync(join(downloadsDir, run.id)), { label: "downloads cleared" });
    await owner.db
      .update(approvals)
      .set({ status: "approved", decidedBy: "user-1" })
      .where(eq(approvals.runId, run.id));
    await owner.db.update(runs).set({ wakeRequestedAt: new Date() }).where(eq(runs.id, run.id));
    await owner.sql.notify(
      "run_wake",
      encodeNotify("run_wake", { runId: run.id, reason: "approval" }),
    );
    await until(run.id, (r) => r.status === "completed", "completed after wake");
    expect(browser.computerRuns).toHaveLength(1);
  });

  it("takeover during an act aborts it, holds without model calls, and hand back re-observes without retrying it", async () => {
    await start();
    const { run, browser } = await queue([click, done]);
    browser.computerHook = (_actions, signal) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    await waitFor(
      async () => (await stepsOf(run.id)).some((s) => s.phase === "act" && s.state === "started"),
      { label: "acting" },
    );
    const requestsBefore = mock.requests.length;
    const takenAt = await dbNow();
    await owner.db
      .update(runs)
      .set({ controller: "user", status: "waiting", waitReason: "takeover" })
      .where(eq(runs.id, run.id));
    await owner.sql.notify("run_control", encodeNotify("run_control", { runId: run.id }));
    const aborted = await waitFor(
      async () => (await stepsOf(run.id)).find((s) => s.state === "aborted"),
      { label: "aborted" },
    );
    expect(aborted.updatedAt.getTime() - takenAt.getTime()).toBeLessThan(CI_BOUND_MS);
    await waitFor(
      async () =>
        (await owner.db.select().from(runEvents).where(eq(runEvents.runId, run.id))).some(
          (e) => e.payload.type === "control" && e.payload.holder === "user",
        ),
      { label: "control event" },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mock.requests.length).toBe(requestsBefore);
    expect(await row(run.id)).toMatchObject({ status: "waiting", controller: "user" });
    browser.computerHook = null;
    await owner.db.update(runs).set({ controller: "agent" }).where(eq(runs.id, run.id));
    await owner.sql.notify("run_control", encodeNotify("run_control", { runId: run.id }));
    await until(run.id, (r) => r.status === "completed", "completed after hand back");
    const steps = await stepsOf(run.id);
    const abortedAt = steps.findIndex((s) => s.state === "aborted");
    expect(steps[abortedAt + 1]?.phase).toBe("observe");
    // The interrupted act is never retried: one act row, one executed action.
    expect(steps.filter((s) => s.phase === "act")).toHaveLength(1);
    expect(browser.executed).toHaveLength(1);
    const last = JSON.stringify(mock.requests.at(-1)?.body.input);
    expect(last).toContain("Interrupted: the user took control");
  });

  it("cancels by web, and the kill switch stops everything quickly and refuses claims", async () => {
    await start();
    const cancelled = await queue([{ ...click, hold: holdFor(2_000) }, done]);
    await until(cancelled.run.id, (r) => r.status === "running", "running");
    await owner.db
      .update(runs)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(runs.id, cancelled.run.id));
    await owner.sql.notify("run_control", encodeNotify("run_control", { runId: cancelled.run.id }));
    await until(cancelled.run.id, (r) => r.slotName === null, "released after cancel");
    await waitFor(async () => (await idleSlots()) === 2, { label: "slot recycled" });

    const active = await queue([{ ...click, hold: holdFor(5_000) }, done]);
    await until(active.run.id, (r) => r.status === "running", "running");
    const killedAt = await dbNow();
    await owner.db.update(settings).set({ killSwitch: true });
    await owner.sql.notify("run_wake", encodeNotify("run_wake", { runId: null, reason: "kill" }));
    await until(active.run.id, (r) => r.status === "cancelled", "killed");
    const final = await row(active.run.id);
    expect(final.finishedAt!.getTime() - killedAt.getTime()).toBeLessThan(CI_BOUND_MS);
    expect(final.error).toMatchObject({ code: "kill_switch" });
    const blocked = await insertRun(owner.db, { workspaceId });
    await owner.sql.notify("run_queued", encodeNotify("run_queued", { runId: blocked.id }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await row(blocked.id)).status).not.toBe("running");
    await owner.db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, blocked.id));
  });

  it("stops without writing when the lease is lost, and graceful stop puts running runs to sleep with a wake", async () => {
    await start();
    const lost = await queue([{ ...click, hold: holdFor(1_000) }, done]);
    await until(lost.run.id, (r) => r.status === "running", "running");
    await owner.db.update(runs).set({ leaseOwner: "someone-else" }).where(eq(runs.id, lost.run.id));
    await waitFor(() => !supervisor!.activeRuns.includes(lost.run.id), {
      label: "worker stopped",
    });
    const steps = (await stepsOf(lost.run.id)).length;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(await stepsOf(lost.run.id)).toHaveLength(steps);
    await owner.db
      .update(runs)
      .set({ status: "cancelled", leaseOwner: null, slotName: null })
      .where(eq(runs.id, lost.run.id));
    // The lost run's slot lease expires and the sweep recycles it.
    await waitFor(async () => (await idleSlots()) === 2, { label: "slot reclaimed" });

    const graceful = await queue([{ ...click, hold: holdFor(3_000) }, done]);
    await until(graceful.run.id, (r) => r.status === "running", "running");
    await supervisor!.stop();
    supervisor = undefined;
    const final = await row(graceful.run.id);
    expect(final).toMatchObject({ status: "sleeping", slotName: null, leaseOwner: null });
    expect(final.wakeRequestedAt).not.toBeNull();
    await owner.db
      .update(runs)
      .set({ status: "cancelled", wakeRequestedAt: null })
      .where(eq(runs.id, graceful.run.id));
  });

  it("a takeover while the run restores its page holds control instead of failing the run (I1)", async () => {
    await start();
    let navigating = false;
    const { run, browser } = await queue([done], "ask", (fake) => {
      fake.navigateHook = (signal) =>
        new Promise((_, reject) => {
          navigating = true;
          signal.addEventListener("abort", () => reject(signal.reason));
        });
    });
    await waitFor(() => navigating, { label: "restoring" });
    await takeOver(run.id);
    await waitFor(async () => (await controlEvents(run.id)).includes("user"), {
      label: "control event",
    });
    expect(await row(run.id)).toMatchObject({ status: "waiting", controller: "user" });
    browser.navigateHook = null;
    await handBackTo(run.id);
    await until(run.id, (r) => r.status === "completed", "completed after hand back");
  });

  it("graceful stop while the user holds control sleeps with a wake; the next agent holds again (I2)", async () => {
    await start();
    const { run } = await queue([{ ...click, hold: holdFor(1_000) }, done]);
    await until(run.id, (r) => r.status === "running", "running");
    await takeOver(run.id);
    await waitFor(async () => (await controlEvents(run.id)).includes("user"), {
      label: "control event",
    });
    await supervisor!.stop();
    supervisor = undefined;
    const slept = await row(run.id);
    expect(slept).toMatchObject({ status: "sleeping", controller: "user", slotName: null });
    expect(slept.wakeRequestedAt).not.toBeNull();
    await start();
    await until(
      run.id,
      (r) => r.status === "waiting" && r.waitReason === "takeover" && r.slotName !== null,
      "holding again on a new agent",
    );
    await handBackTo(run.id);
    await until(run.id, (r) => r.status === "completed", "completed after hand back");
  });

  it("a re-claim of its own run after a heartbeat outage leaves exactly one tracked worker (I3)", async () => {
    await start();
    const { run, name } = await queue([
      { ...click, hold: holdFor(1_500) },
      { ...done, hold: holdFor(2_000) },
    ]);
    await waitFor(() => mock.requestsFor(name).length === 1, { label: "first worker deciding" });
    // The heartbeat outage: the lease lapses while the first worker still runs, and the same
    // supervisor claims the run again.
    await owner.db
      .update(runs)
      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(runs.id, run.id));
    await owner.sql.notify("run_queued", encodeNotify("run_queued", { runId: run.id }));
    await waitFor(() => mock.requestsFor(name).length === 2, { label: "second worker deciding" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    // The first worker is gone; the map entry still points at the live second worker.
    expect(supervisor!.activeRuns).toEqual([run.id]);
    await until(run.id, (r) => r.status === "completed", "completed");
    expect(browsers.get(run.id)!.executed).toEqual([]);
  });

  it("a true crash leaves the started act without an abort row, and restore never retries it (M4)", async () => {
    await start();
    const { run, browser } = await queue(
      [click, { ...done, check: expectInput("Not retried") }],
      "ask",
      (fake) => {
        fake.computerHook = (_actions, signal) =>
          new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      },
    );
    await waitFor(
      async () => (await stepsOf(run.id)).some((s) => s.phase === "act" && s.state === "started"),
      { label: "acting" },
    );
    await supervisor!.crash();
    supervisor = undefined;
    const acts = (await stepsOf(run.id)).filter((s) => s.phase === "act");
    expect(acts.map((s) => s.state)).toEqual(["started"]);
    browser.computerHook = null;
    await start();
    await until(run.id, (r) => r.status === "completed", "completed after restore");
    expect(browser.executed).toHaveLength(1);
    expect((await stepsOf(run.id)).filter((s) => s.phase === "act")).toHaveLength(1);
  });

  it("the kill sweep still runs while a slot restart hangs, and stop() is bounded (M5, M1)", async () => {
    await start({ config: { shutdownDrainMs: 300 }, control: stuckControl() });
    // A slot left restarting (e.g. by a dead agent) that never comes back.
    await owner.db
      .update(browserSlots)
      .set({ state: "restarting", runId: null, leaseOwner: null, leaseExpiresAt: null })
      .where(eq(browserSlots.name, "browser-2"));
    await new Promise((resolve) => setTimeout(resolve, 700)); // a sweep is now stuck on it
    // Kill without NOTIFY: only the sweep fallback can see it.
    await owner.db.update(settings).set({ killSwitch: true });
    const queued = await insertRun(owner.db, { workspaceId });
    await until(queued.id, (r) => r.status === "cancelled", "cancelled by the sweep");
    const stopping = Date.now();
    await supervisor!.stop();
    supervisor = undefined;
    expect(Date.now() - stopping).toBeLessThan(2_000);
  });

  it("a kill that races a web cancel still frees the slot at once (M7)", async () => {
    await start();
    const { run } = await queue([{ ...click, hold: holdFor(5_000) }, done]);
    await until(run.id, (r) => r.status === "running", "running");
    const slot = (await row(run.id)).slotName!;
    // The web cancelled, but its run_control has not reached the worker yet.
    await owner.db
      .update(runs)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(runs.id, run.id));
    await owner.db.update(settings).set({ killSwitch: true });
    const killed = Date.now();
    await owner.sql.notify("run_wake", encodeNotify("run_wake", { runId: null, reason: "kill" }));
    await waitFor(
      async () =>
        (
          await owner.db
            .select()
            .from(browserSlots)
            .where(and(eq(browserSlots.name, slot), eq(browserSlots.state, "leased")))
        ).length === 0,
      { label: "slot freed", intervalMs: 20 },
    );
    // Well before the 2 s lease could expire and the sweep reclaim it.
    expect(Date.now() - killed).toBeLessThan(1_000);
    expect((await row(run.id)).slotName).toBeNull();
  });
});
