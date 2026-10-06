import { MODELS, type Budget } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { approvals, createDb, runEvents, runSteps, runs, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { MockTurn } from "../../../../tests/llm-mock/src/scenario.ts";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { ModelCaller } from "../llm/caller.ts";
import { createOpenAIModelClient } from "../llm/client.ts";
import { instantClock } from "../runtime/clock.ts";
import { runtimeConfig } from "../runtime/config.ts";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { FakeLoopBrowser } from "../testing/fake-loop-browser.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { withHooks } from "./hooks.ts";
import { RunLoop, type StepOutcome } from "./run-loop.ts";
import { snapshotOf } from "./run-state.ts";
import { NO_SESSION_STORE, StepStore } from "./step-store.ts";

const log = createLogger({ service: "test", level: "silent" });
const OWNER = "loop-test";
let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let mock: LlmMock;
let workspaceId: string;
let counter = 0;

beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl);
  agent = createDb(database.agentUrl);
  mock = await startLlmMock();
  workspaceId = await seedWorkspace(owner.db);
});
afterAll(async () => {
  await mock?.close();
  await agent?.close();
  await owner?.close();
  await database?.stop();
});
// Every model call must be answered by exactly one output; the mock records any pairing problem.
afterEach(() => {
  expect(mock.failures.splice(0)).toEqual([]);
});

const done = (reason = "Finished"): MockTurn => ({
  outputs: [{ type: "turn", status: "done", reason }],
});
const click = (x = 10, y = 20): MockTurn => ({
  outputs: [{ type: "computer", actions: [{ type: "click", x, y, button: "left" }] }],
});
const doneExpecting = (text: string): MockTurn => ({
  outputs: [{ type: "turn", status: "done", reason: "ok" }],
  check: (r) => {
    if (!JSON.stringify(r.body.input).includes(text)) throw new Error(`no "${text}" in the input`);
  },
});
const risky = (label: string) => ({
  label,
  tag: "button",
  isFormSubmit: false,
  formKind: null,
  isSecretField: false,
  editable: false,
  interactive: true,
});

async function setup(
  turns: MockTurn[],
  options: { approvalMode?: "ask" | "auto_within_allowlist"; budget?: Budget } = {},
) {
  const name = `s${++counter}`;
  mock.setScenarios([{ name, turns }]);
  const row = await insertRun(owner.db, {
    workspaceId,
    goal: `[scenario:${name}] Do the task`,
    status: "running",
    leaseOwner: OWNER,
    approvalMode: options.approvalMode,
    budget: options.budget,
  });
  const browser = new FakeLoopBrowser();
  const storage = createMemoryStorage();
  const caller = new ModelCaller(
    createOpenAIModelClient({ apiKey: "k", baseURL: `${mock.url}/v1` }),
    { clock: instantClock(), fallbackAfter5xx: 3 },
  );
  const deps = async () => ({
    db: agent.db,
    storage,
    caller,
    browser,
    hooks: withHooks(),
    clock: instantClock(),
    config: runtimeConfig(),
    log,
    store: await StepStore.open({
      db: agent.db,
      storage,
      sessionStore: NO_SESSION_STORE,
      owner: OWNER,
      run: row,
    }),
  });
  const reload = async () => {
    const [fresh] = await owner.db.select().from(runs).where(eq(runs.id, row.id));
    return RunLoop.restore(await deps(), snapshotOf(fresh!));
  };
  return { name, run: row, browser, loop: await reload(), reload };
}

async function drive(loop: RunLoop, max = 60): Promise<StepOutcome> {
  for (let i = 0; i < max; i++) {
    const outcome = await loop.step(new AbortController().signal);
    if (outcome.kind !== "continue") return outcome;
  }
  throw new Error("the loop did not stop");
}

const phases = async (runId: string) =>
  (
    await owner.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .orderBy(asc(runSteps.seq))
  ).map((s) => `${s.phase}:${s.state}`);
const status = async (runId: string) =>
  (await owner.db.select().from(runs).where(eq(runs.id, runId)))[0];
const approvalRows = (runId: string) =>
  owner.db
    .select()
    .from(approvals)
    .where(eq(approvals.runId, runId))
    .orderBy(asc(approvals.createdAt));
/** Decides the pending approval(s) only; earlier decisions stay as they were. */
const decideApproval = (
  runId: string,
  outcome: "approved" | "denied" | "edited",
  edit: unknown = null,
) =>
  owner.db
    .update(approvals)
    .set({ status: outcome, decidedBy: "user-1", edit: edit as never })
    .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")));

describe("RunLoop (spec §5.3)", () => {
  it("runs observe → decide → approve → act and completes", async () => {
    const { run, browser, loop } = await setup([click(), done()]);
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(browser.computerRuns).toEqual([[{ type: "click", x: 10, y: 20, button: "left" }]]);
    expect(await phases(run.id)).toEqual([
      "observe:done",
      "decide:done",
      "approve:skipped",
      "act:done",
      "observe:done",
      "decide:done",
    ]);
    expect(await status(run.id)).toMatchObject({ status: "completed", usage: { steps: 2 } });
    expect(JSON.stringify(mock.requests.at(-1)?.body.input)).toContain("computer_call_output");
  });

  it("asks for approval of a risky click, then acts after approval (ask mode)", async () => {
    const { run, browser, loop, reload } = await setup([click(), done()]);
    browser.targets.set("10,20", risky("Delete account"));
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    expect(browser.computerRuns).toEqual([]);
    expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "approval" });
    await decideApproval(run.id, "approved");
    const resumed = await reload();
    expect(await resumed.resume(new AbortController().signal)).toEqual({ kind: "continue" });
    expect(await drive(resumed)).toEqual({ kind: "completed" });
    expect(browser.computerRuns).toHaveLength(1);
  });

  it("needs one approval per risky action in a batch and runs only what was approved (security ruling)", async () => {
    const { run, browser, loop, reload } = await setup([
      {
        outputs: [
          {
            type: "computer",
            actions: [
              { type: "click", x: 10, y: 20, button: "left" },
              { type: "click", x: 30, y: 40, button: "left" },
            ],
          },
        ],
      },
      doneExpecting("denied"),
    ]);
    browser.targets.set("10,20", risky("Delete account"));
    browser.targets.set("30,40", risky("Pay now"));
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    expect(
      (await approvalRows(run.id)).map((r) => [r.status, (r.request as { label: string }).label]),
    ).toEqual([["pending", "Delete account"]]);
    await decideApproval(run.id, "approved");
    const second = await reload();
    expect(await second.resume(new AbortController().signal)).toEqual({ kind: "continue" });
    // The first approval does not cover "Pay now": it needs its own.
    expect(await drive(second)).toEqual({ kind: "waiting", reason: "approval" });
    expect(browser.executed).toEqual([]);
    expect(
      (await approvalRows(run.id)).map((r) => [r.status, (r.request as { label: string }).label]),
    ).toEqual([
      ["approved", "Delete account"],
      ["pending", "Pay now"],
    ]);
    await decideApproval(run.id, "denied");
    const third = await reload();
    await third.resume(new AbortController().signal);
    expect(await drive(third)).toEqual({ kind: "completed" });
    expect(browser.executed).toEqual([{ type: "click", x: 10, y: 20, button: "left" }]);
  });

  it("needs one approval per risky call when a response holds several calls", async () => {
    const { run, browser, loop, reload } = await setup([
      {
        outputs: [
          { type: "computer", actions: [{ type: "click", x: 10, y: 20, button: "left" }] },
          { type: "computer", actions: [{ type: "click", x: 30, y: 40, button: "left" }] },
        ],
      },
      done(),
    ]);
    browser.targets.set("10,20", risky("Delete account"));
    browser.targets.set("30,40", risky("Pay now"));
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    await decideApproval(run.id, "approved");
    const second = await reload();
    await second.resume(new AbortController().signal);
    expect(await drive(second)).toEqual({ kind: "waiting", reason: "approval" });
    expect(browser.executed).toEqual([]);
    await decideApproval(run.id, "approved");
    const third = await reload();
    await third.resume(new AbortController().signal);
    expect(await drive(third)).toEqual({ kind: "completed" });
    expect(browser.executed).toHaveLength(2);
    expect((await approvalRows(run.id)).map((r) => r.status)).toEqual(["approved", "approved"]);
  });

  it("decides by policy in auto mode and records it", async () => {
    const { run, browser, loop } = await setup([click(), done()], {
      approvalMode: "auto_within_allowlist",
    });
    browser.targets.set("10,20", risky("Submit answer"));
    expect(await drive(loop)).toEqual({ kind: "completed" });
    const [row] = await approvalRows(run.id);
    expect(row).toMatchObject({ kind: "risky_click", status: "approved", decidedBy: "policy" });
    const types = (await owner.db.select().from(runEvents).where(eq(runEvents.runId, run.id))).map(
      (e) => e.type,
    );
    expect(types).toEqual(expect.arrayContaining(["approval_requested", "approval_resolved"]));
  });

  it("decides by policy in auto mode, one recorded decision per risky action", async () => {
    const { run, browser, loop } = await setup(
      [
        {
          outputs: [
            {
              type: "computer",
              actions: [
                { type: "click", x: 10, y: 20, button: "left" },
                { type: "click", x: 30, y: 40, button: "left" },
              ],
            },
          ],
        },
        done(),
      ],
      { approvalMode: "auto_within_allowlist" },
    );
    browser.targets.set("10,20", risky("Submit answer"));
    browser.targets.set("30,40", risky("Confirm"));
    expect(await drive(loop)).toEqual({ kind: "completed" });
    const rows = await approvalRows(run.id);
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(row).toMatchObject({ kind: "risky_click", status: "approved", decidedBy: "policy" });
    expect(browser.executed).toHaveLength(2);
    const types = (await owner.db.select().from(runEvents).where(eq(runEvents.runId, run.id))).map(
      (e) => e.type,
    );
    expect(types).toEqual(expect.arrayContaining(["approval_requested", "approval_resolved"]));
  });

  it("supersedes an approval when the page changed while waiting, and reports denials", async () => {
    const first = await setup([click(), doneExpecting("page changed")]);
    first.browser.targets.set("10,20", risky("Pay now"));
    await drive(first.loop);
    await decideApproval(first.run.id, "approved");
    first.browser.domHash = "e".repeat(64);
    const resumed = await first.reload();
    await resumed.resume(new AbortController().signal);
    expect(await drive(resumed)).toEqual({ kind: "completed" });
    expect(first.browser.computerRuns).toEqual([]);
    expect((await approvalRows(first.run.id))[0]?.status).toBe("superseded");

    const second = await setup([click(), doneExpecting("denied")]);
    second.browser.targets.set("10,20", risky("Pay now"));
    await drive(second.loop);
    await decideApproval(second.run.id, "denied");
    const again = await second.reload();
    await again.resume(new AbortController().signal);
    expect(await drive(again)).toEqual({ kind: "completed" });
    expect(second.browser.computerRuns).toEqual([]);
  });

  it("keeps a new origin blocked by policy in auto mode, records it, and tells the model", async () => {
    const { run, browser, loop } = await setup(
      [click(), doneExpecting("not one of this run's allowed origins")],
      { approvalMode: "auto_within_allowlist" },
    );
    browser.computerHook = async () => {
      browser.blocked.push({
        url: "http://other.fixtures.test/steal",
        origin: "http://other.fixtures.test",
      });
    };
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(browser.navigations).toEqual([]);
    expect(await approvalRows(run.id)).toMatchObject([
      { kind: "new_origin", status: "denied", decidedBy: "policy" },
    ]);
    expect((await status(run.id))?.allowedOrigins).toEqual(["http://site.fixtures.test"]);
  });

  it("turns a budget hit into a budget approval and extends by 50% when approved", async () => {
    const { run, loop, reload } = await setup([click(), click(), done()], {
      budget: { maxSteps: 1, maxUsd: 5, maxActiveMinutes: 60 },
    });
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    expect((await approvalRows(run.id))[0]?.kind).toBe("budget");
    await decideApproval(run.id, "approved", { instruction: null, budgetChoice: "extend" });
    const resumed = await reload();
    await resumed.resume(new AbortController().signal);
    expect((await status(run.id))?.budget).toMatchObject({ maxSteps: 2 });
    // The click that ran before the budget wait is answered with its real result, not "not run".
    const outcome = await resumed.step(new AbortController().signal);
    expect(outcome).toEqual({ kind: "continue" });
    const last = JSON.stringify(mock.requestsFor(`s${counter}`).at(-1)?.body.input);
    expect(last).toContain("computer_call_output");
    expect(last).not.toContain("Not run");
  });

  it("waits for a person on CAPTCHA, need_human and a stuck loop", async () => {
    const captcha = await setup([done()]);
    captcha.browser.captcha = true;
    expect(await drive(captcha.loop)).toEqual({ kind: "waiting", reason: "captcha" });
    const human = await setup([
      {
        outputs: [
          { type: "turn", status: "need_human", needHuman: "takeover", reason: "Needs the user" },
        ],
      },
    ]);
    expect(await drive(human.loop)).toEqual({ kind: "waiting", reason: "takeover" });
    const stuck = await setup([click(), click(), click(), done()]);
    expect(await drive(stuck.loop)).toEqual({ kind: "waiting", reason: "takeover" });
    expect(await status(stuck.run.id)).toMatchObject({ waitReason: "takeover" });
  });

  it("does not mistake scrolling down a long page for a loop", async () => {
    const scroll: MockTurn = {
      outputs: [
        {
          type: "computer",
          actions: [{ type: "scroll", x: 400, y: 300, scroll_x: 0, scroll_y: 600 }],
        },
      ],
    };
    const { browser, loop } = await setup([...Array.from({ length: 10 }, () => scroll), done()]);
    browser.computerHook = async () => {
      browser.scroll = { x: 0, y: browser.scroll.y + 600 };
    };
    expect(await drive(loop, 100)).toEqual({ kind: "completed" });
    expect(browser.computerRuns).toHaveLength(10);
  });

  it("answers invalid calls with an error and keeps going", async () => {
    const { browser, loop } = await setup([
      { outputs: [{ type: "function", name: "read_page", args: { mode: "everything" } }] },
      doneExpecting("Invalid call"),
    ]);
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(browser.functionRuns).toEqual([]);
  });

  it("compacts above 200K input tokens and rebuilds a lost chain", async () => {
    const big = await setup([{ ...click(), usage: { input: 210_000 } }, done()]);
    expect(await drive(big.loop)).toEqual({ kind: "completed" });
    const requests = mock.requestsFor(big.name);
    expect(requests.some((r) => r.body.text?.format?.name === "compaction_summary")).toBe(true);
    expect(requests.at(-1)?.body.previous_response_id ?? null).toBeNull();

    const lost = await setup([
      click(),
      { error: { status: 400, code: "previous_response_not_found" } },
      done(),
    ]);
    expect(await drive(lost.loop)).toEqual({ kind: "completed" });
    expect(mock.requestsFor(lost.name).at(-1)?.body.previous_response_id ?? null).toBeNull();
  });

  it("compacts now when the model reports context_length_exceeded", async () => {
    const { name, loop } = await setup([
      click(),
      { error: { status: 400, code: "context_length_exceeded" } },
      done(),
    ]);
    expect(await drive(loop)).toEqual({ kind: "completed" });
    const requests = mock.requestsFor(name);
    expect(requests.some((r) => r.body.text?.format?.name === "compaction_summary")).toBe(true);
    expect(requests.at(-1)?.body.previous_response_id ?? null).toBeNull();
  });

  it("compacts after a restore when the last turn was above 200K", async () => {
    const { name, loop, reload } = await setup([{ ...click(), usage: { input: 210_000 } }, done()]);
    expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" }); // observe
    expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" }); // decide
    expect(await drive(await reload())).toEqual({ kind: "completed" });
    expect(
      mock.requestsFor(name).some((r) => r.body.text?.format?.name === "compaction_summary"),
    ).toBe(true);
  });

  it("falls back after three 5xx and records model_fallback", async () => {
    const { run, loop } = await setup([
      { error: { status: 500 } },
      { error: { status: 502 } },
      { error: { status: 503 } },
      done(),
    ]);
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect((await status(run.id))?.model).toBe(MODELS.agentFallback);
    const types = (await owner.db.select().from(runEvents).where(eq(runEvents.runId, run.id))).map(
      (e) => e.type,
    );
    expect(types).toContain("model_fallback");
  });

  it("never retries a started act after a restart (crash/restore)", async () => {
    const { run, browser, loop, reload } = await setup([click(), doneExpecting("Not retried")]);
    browser.computerHook = async () => {
      throw new Error("process died");
    };
    await expect(drive(loop)).rejects.toThrow("process died");
    expect(await phases(run.id)).toContain("act:started");
    browser.computerHook = null;
    const restored = await reload();
    expect(await drive(restored)).toEqual({ kind: "completed" });
    expect(browser.computerRuns).toHaveLength(1);
  });

  it("answers calls left unanswered by a crash before act, without running them", async () => {
    const { browser, loop, reload } = await setup([click(), doneExpecting("Not retried")]);
    expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" }); // observe
    expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" }); // decide
    expect(await drive(await reload())).toEqual({ kind: "completed" });
    expect(browser.executed).toEqual([]);
  });

  it("rechecks approval at execution time (Review Focus 3)", async () => {
    const { browser, loop } = await setup([
      {
        outputs: [
          {
            type: "computer",
            actions: [
              { type: "click", x: 10, y: 20, button: "left" },
              { type: "click", x: 30, y: 40, button: "left" },
            ],
          },
        ],
      },
      done(),
    ]);
    let calls = 0;
    const original = browser.targetFor.bind(browser);
    browser.targetFor = async (action, previous) => {
      calls += 1;
      if (calls > 2 && action.type === "click" && action.x === 30)
        return risky("Delete everything");
      return original(action, previous);
    };
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(browser.computerRuns).toEqual([]);
    expect(browser.executed).toEqual([{ type: "click", x: 10, y: 20, button: "left" }]);
  });
});
