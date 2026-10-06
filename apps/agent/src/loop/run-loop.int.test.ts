import { MODELS, type ApprovalMode, type Budget } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import {
  approvals,
  createDb,
  emitRunEvent,
  requestHandBack,
  requestTakeover,
  runEvents,
  runSteps,
  runs,
  type DbHandle,
} from "@mastertutor/db";
import { seedMember, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { MockTurn } from "../../../../tests/llm-mock/src/scenario.ts";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { ModelCaller } from "../llm/caller.ts";
import { NUDGE } from "../llm/instructions.ts";
import { FORBIDDEN_RESPONSE_FIELDS } from "../llm/openai.ts";
import { createOpenAIModelClient } from "../llm/client.ts";
import { instantClock } from "../runtime/clock.ts";
import { runtimeConfig } from "../runtime/config.ts";
import { ControlHeld, Interrupted } from "../runtime/errors.ts";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { FakeLoopBrowser, PLAIN_TARGET } from "../testing/fake-loop-browser.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { withHooks, type RunHooks } from "./hooks.ts";
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
const ALLOWED_PATHS = new Set(["/v1/responses", "/v1/embeddings", "/v1/audio/transcriptions"]);
/** openai-data-policy.md rule 6: stateless, anonymous and allowlisted only. */
function expectPolicy(requests: typeof mock.requests): void {
  for (const request of requests) {
    expect(ALLOWED_PATHS.has(request.path)).toBe(true);
    expect(request.body.store).toBe(false);
    for (const field of FORBIDDEN_RESPONSE_FIELDS) expect(request.body).not.toHaveProperty(field);
  }
}
let policyChecked = 0;
// Every model call must be answered by exactly one output; the mock records any pairing problem.
// Every request a test made also goes through the data policy, whatever order the tests run in.
afterEach(() => {
  expect(mock.failures.splice(0)).toEqual([]);
  expectPolicy(mock.requests.slice(policyChecked));
  policyChecked = mock.requests.length;
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
const risky = (label: string, path = `button:${label}`, context = "page") => ({
  label,
  tag: "button",
  path,
  context,
  isFormSubmit: false,
  formKind: null,
  isSecretField: false,
  editable: false,
  interactive: true,
});

async function setup(
  turns: MockTurn[],
  options: {
    approvalMode?: ApprovalMode;
    budget?: Budget;
    hooks?: Partial<RunHooks>;
    leaseExpired?: () => boolean;
  } = {},
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
    hooks: withHooks(options.hooks),
    ...(options.leaseExpired ? { leaseExpired: options.leaseExpired } : {}),
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
  return { name, run: row, browser, storage, loop: await reload(), reload };
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

  describe("downloads (spec §9)", () => {
    const attempt = {
      url: "https://u:p@site.fixtures.test/files/r.csv",
      filename: "../r\u202e.csv",
    };

    it("asks a person about a download the page started, then allows only that one", async () => {
      const { run, browser, loop, reload } = await setup([
        click(),
        doneExpecting("the user approved downloading"),
      ]);
      browser.computerHook = async () => void browser.blockedDownloads.push(attempt);
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      expect(await approvalRows(run.id)).toMatchObject([
        {
          kind: "download",
          status: "pending",
          request: {
            kind: "download",
            url: "https://site.fixtures.test/files/r.csv",
            filename: "_r.csv",
          },
        },
      ]);
      expect(browser.allowedDownloads).toEqual([]);
      await decideApproval(run.id, "approved");
      const resumed = await reload();
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(browser.allowedDownloads).toEqual(["https://site.fixtures.test/files/r.csv"]);
    });

    it("never lets auto mode's policy approve a download: it is denied, recorded and reported", async () => {
      const { run, browser, loop } = await setup(
        [click(), doneExpecting("Downloads need the user's approval")],
        { approvalMode: "auto_within_allowlist" },
      );
      browser.computerHook = async () => void browser.blockedDownloads.push(attempt);
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(await approvalRows(run.id)).toMatchObject([
        { kind: "download", status: "denied", decidedBy: "policy" },
      ]);
      expect(browser.allowedDownloads).toEqual([]);
    });

    it("asks before clicking a download link, and lets that download through once approved", async () => {
      const { run, browser, loop, reload } = await setup([click(), done()]);
      const link = {
        ...PLAIN_TARGET,
        label: "Report",
        tag: "a",
        path: "a:report",
        interactive: true,
        download: { url: "https://site.fixtures.test/files/r.csv", filename: "r.csv" },
      };
      browser.targets.set("10,20", link);
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      expect(browser.executed).toEqual([]);
      expect(await approvalRows(run.id)).toMatchObject([
        { kind: "download", request: { url: link.download.url, filename: "r.csv" } },
      ]);
      await decideApproval(run.id, "approved");
      const resumed = await reload();
      browser.targets.set("10,20", link);
      browser.actionHook = async () =>
        void expect(browser.allowedDownloads).toEqual([link.download.url]);
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(browser.executed).toHaveLength(1);
    });
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

  it("compacts above 200K input tokens and continues from the seed", async () => {
    const big = await setup([{ ...click(), usage: { input: 210_000 } }, done()]);
    expect(await drive(big.loop)).toEqual({ kind: "completed" });
    const requests = mock.requestsFor(big.name);
    expect(requests.some((r) => r.body.text?.format?.name === "compaction_summary")).toBe(true);
    const last = JSON.stringify(requests.at(-1)?.body.input);
    expect(last).toContain("continues from a summary");
    expect(last).not.toContain("Do the task");
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
    expect(JSON.stringify(requests.at(-1)?.body.input)).toContain("continues from a summary");
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
  describe("pending safety checks (ruling: only irrelevant_domain on an allowed origin is auto-cleared)", () => {
    const flagged = (code: string): MockTurn => ({
      outputs: [
        {
          type: "computer",
          actions: [{ type: "click", x: 10, y: 20, button: "left" }],
          safetyChecks: [{ id: "sc_1", code, message: `Flagged: ${code}` }],
        },
      ],
    });

    it("waits for a person on malicious_instructions in auto mode", async () => {
      const { run, browser, loop } = await setup([flagged("malicious_instructions"), done()], {
        approvalMode: "auto_within_allowlist",
      });
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      expect(browser.executed).toEqual([]);
      expect(await approvalRows(run.id)).toMatchObject([
        {
          kind: "risky_click",
          status: "pending",
          request: { safetyChecks: [{ code: "malicious_instructions" }] },
        },
      ]);
    });

    it("approves irrelevant_domain on an allowed origin by policy and acknowledges it", async () => {
      const { run, name, browser, loop } = await setup(
        [flagged("irrelevant_domain"), doneExpecting("acknowledged_safety_checks")],
        { approvalMode: "auto_within_allowlist" },
      );
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(browser.executed).toHaveLength(1);
      expect(await approvalRows(run.id)).toMatchObject([
        { kind: "risky_click", status: "approved", decidedBy: "policy" },
      ]);
      expect(JSON.stringify(mock.requestsFor(name).at(-1)?.body.input)).toContain('"id":"sc_1"');
    });

    it("waits for a person on irrelevant_domain on an origin outside the allowlist", async () => {
      const { browser, loop } = await setup([flagged("irrelevant_domain"), done()], {
        approvalMode: "auto_within_allowlist",
      });
      browser.url = "http://other.fixtures.test/page";
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      expect(browser.executed).toEqual([]);
    });

    it("asks about the safety check before the click it flags", async () => {
      const { run, browser, loop } = await setup([flagged("sensitive_domain"), done()]);
      browser.targets.set("10,20", risky("Delete account"));
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      const [first] = await approvalRows(run.id);
      expect(first?.request).toMatchObject({ safetyChecks: [{ code: "sensitive_domain" }] });
    });
  });

  it("binds an approval to its target: an earlier action that changes the target voids it", async () => {
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
      doneExpecting("page changed"),
    ]);
    browser.targets.set("30,40", risky("Delete account"));
    browser.actionHook = (action) => {
      if (action.type === "click" && action.x === 10)
        browser.targets.set("30,40", risky("Pay now"));
    };
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    await decideApproval(run.id, "approved");
    const resumed = await reload();
    await resumed.resume(new AbortController().signal);
    expect(await drive(resumed)).toEqual({ kind: "completed" });
    expect(browser.executed).toEqual([{ type: "click", x: 10, y: 20, button: "left" }]);
  });

  it("binds an approval to the element: a same-label button on another row is not approved (M10)", async () => {
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
      doneExpecting("page changed"),
    ]);
    browser.targets.set("30,40", risky("Delete", "table>tr:1>td>button"));
    // Action 0 re-sorts the table: the point of action 1 now hits row 2's "Delete".
    browser.actionHook = (action) => {
      if (action.type === "click" && action.x === 10)
        browser.targets.set("30,40", risky("Delete", "table>tr:2>td>button"));
    };
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    await decideApproval(run.id, "approved");
    const resumed = await reload();
    await resumed.resume(new AbortController().signal);
    expect(await drive(resumed)).toEqual({ kind: "completed" });
    expect(browser.executed).toEqual([{ type: "click", x: 10, y: 20, button: "left" }]);
  });

  it("stores each screenshot once, shared by its step and the transcript (M4)", async () => {
    const { run, browser, storage, loop } = await setup([click(10), click(11), click(12), done()]);
    browser.png = Buffer.from("one screenshot");
    expect(await drive(loop)).toEqual({ kind: "completed" });
    const keys = [...storage.objects.keys()];
    const observed = (await owner.db.select().from(runSteps).where(eq(runSteps.runId, run.id)))
      .filter((step) => step.screenshotKey !== null)
      .map((step) => step.screenshotKey);
    expect(keys.filter((key) => key.includes("/transcript/"))).toEqual([]);
    expect(keys.sort()).toEqual([...observed].sort());
  });

  it("keeps the transcript and recent images in memory: an uninterrupted run reads no image back (M5)", async () => {
    const { browser, storage, loop } = await setup([
      click(10),
      click(11),
      click(12),
      click(13),
      click(14),
      done(),
    ]);
    browser.png = Buffer.from("another screenshot");
    const read = storage.getBytes.bind(storage);
    let reads = 0;
    storage.getBytes = async (key: string) => {
      reads += 1;
      return read(key);
    };
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(reads).toBe(0);
  });

  it("carries this turn's executor notes verbatim into the context after a compaction (M7)", async () => {
    const note = "Executor: navigation to http://other.fixtures.test was blocked";
    const { name, browser, loop } = await setup(
      [{ ...click(), usage: { input: 210_000 } }, click(11), done()],
      { approvalMode: "auto_within_allowlist" },
    );
    let first = true;
    browser.computerHook = async () => {
      if (!first) return;
      first = false;
      browser.blocked.push({
        url: "http://other.fixtures.test/a",
        origin: "http://other.fixtures.test",
      });
    };
    for (let i = 0; i < 4; i++)
      expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" });
    expect(await drive(loop)).toEqual({ kind: "completed" });
    const turns = mock.requestsFor(name).filter((r) => r.body.text?.format?.name === "agent_turn");
    expect(turns).toHaveLength(3);
    for (const turn of turns.slice(1)) {
      const input = JSON.stringify(turn.body.input);
      expect(input).toContain("continues from a summary");
      expect(input).toContain(note);
    }
  });

  describe("external review run 29", () => {
    const key = (...keys: string[]) => ({ type: "keypress" as const, keys });
    const batch = (...actions: Array<Record<string, unknown>>): MockTurn => ({
      outputs: [{ type: "computer", actions }],
    });
    const save = {
      ...risky("Save", "form>button"),
      isFormSubmit: true,
      formKind: "other" as const,
    };
    const field = {
      ...risky("Title", "form>input"),
      tag: "input",
      editable: true,
      formKind: "other" as const,
    };
    const opaque = {
      ...risky("", "iframe@opaque"),
      label: "Embedded page that could not be inspected",
      tag: "iframe",
      opaqueFrame: true,
    };

    it("stops Space at act time once Tab has moved focus onto a submit button (R29-2)", async () => {
      const { browser, loop } = await setup([
        batch(
          { type: "click", x: 10, y: 20, button: "left" },
          { type: "type", text: "a b" },
          key("TAB"),
          key("SPACE"),
        ),
        doneExpecting("needs approval"),
      ]);
      browser.targets.set("10,20", field);
      browser.actionHook = (action) => {
        if (action.type === "keypress" && action.keys[0] === "TAB") browser.focused = save;
      };
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(browser.executed.map((action) => action.type)).toEqual(["click", "type", "keypress"]);
    });

    it("asks before Space on a focused submit button, and runs it only once approved (R29-2)", async () => {
      const { run, browser, loop, reload } = await setup([batch(key("SHIFT", "SPACE")), done()]);
      browser.focused = save;
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      expect(browser.executed).toEqual([]);
      await decideApproval(run.id, "approved");
      const resumed = await reload();
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(browser.executed).toEqual([key("SHIFT", "SPACE")]);
    });

    it("asks before a click, Enter or Space into an embedded page it could not inspect (R29-1)", async () => {
      const { run, browser, loop, reload } = await setup([
        batch({ type: "click", x: 10, y: 20, button: "left" }, key("ENTER"), key("SPACE")),
        doneExpecting("denied"),
      ]);
      browser.targets.set("10,20", opaque);
      browser.focused = opaque;
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      expect((await approvalRows(run.id))[0]).toMatchObject({ kind: "form_submit" });
      await decideApproval(run.id, "denied");
      const resumed = await reload();
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(browser.executed).toEqual([]);
    });

    // A field on a page whose typing guard could not cover every document reads as uninspectable.
    const unguarded = { ...field, path: "form>input:1", opaqueFrame: true };

    it("auto mode: a policy approval never lets typing run with an incomplete guard (fix round 5)", async () => {
      const { browser, loop } = await setup([batch({ type: "type", text: "abc" }), done()], {
        approvalMode: "auto_within_allowlist",
      });
      browser.focused = unguarded;
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(browser.verdicts).toEqual([{ target: unguarded, personApproved: false }]);
    });

    it.each([
      ["the approved element", unguarded, true],
      ["another element (no approval needed there)", { ...field, path: "form>input:2" }, false],
    ])(
      "a person's approval unguards typing only on the element approved: %s (fix round 5)",
      async (_case, focusedAtAct, personApproved) => {
        const { run, browser, loop, reload } = await setup([
          batch({ type: "type", text: "abc" }),
          done(),
        ]);
        browser.focused = unguarded;
        expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
        await decideApproval(run.id, "approved");
        // The restore after the wait: focus is now on what the test says.
        browser.focused = focusedAtAct;
        const resumed = await reload();
        await resumed.resume(new AbortController().signal);
        expect(await drive(resumed)).toEqual({ kind: "completed" });
        expect(browser.verdicts).toEqual([{ target: focusedAtAct, personApproved }]);
      },
    );

    it("binds an approval to its record: a delete approved on Alice is refused on Bobby (R29-3)", async () => {
      const { run, browser, loop, reload } = await setup([click(), doneExpecting("page changed")]);
      browser.targets.set("10,20", risky("Delete", "html>body>button", "h(Alice)"));
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      // Same button, label, path, URL and DOM hash: only the record it acts on changed.
      browser.targets.set("10,20", risky("Delete", "html>body>button", "h(Bobby)"));
      await decideApproval(run.id, "approved");
      const resumed = await reload();
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(browser.executed).toEqual([]);
    });

    it("runs an approved action when its record is unchanged (R29-3 control)", async () => {
      const { run, browser, loop, reload } = await setup([click(), done()]);
      browser.targets.set("10,20", risky("Delete", "html>body>button", "h(Alice)"));
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      await decideApproval(run.id, "approved");
      const resumed = await reload();
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(browser.executed).toHaveLength(1);
    });
  });

  it("tells the model about every blocked navigation, not only the first", async () => {
    const { run, browser, loop } = await setup(
      [click(), doneExpecting("http://third.fixtures.test")],
      { approvalMode: "auto_within_allowlist" },
    );
    browser.computerHook = async () => {
      browser.blocked.push(
        { url: "http://other.fixtures.test/a", origin: "http://other.fixtures.test" },
        { url: "http://third.fixtures.test/b", origin: "http://third.fixtures.test" },
      );
    };
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect((await approvalRows(run.id)).map((r) => [r.kind, r.status])).toEqual([
      ["new_origin", "denied"],
      ["new_origin", "denied"],
    ]);
  });

  it("does not mistake paging with the same Next button for a loop", async () => {
    const { browser, loop } = await setup([click(), click(), click(), click(), done()]);
    let page = 0;
    browser.computerHook = async () => {
      page += 1;
      browser.domHash = String(page).repeat(64).slice(0, 64);
    };
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(browser.executed).toHaveLength(4);
  });

  it("counts compaction usage even when the following model call fails", async () => {
    const { run, loop } = await setup([
      { ...click(), usage: { input: 210_000 } },
      { error: { status: 400, code: "invalid_value" } },
    ]);
    await expect(drive(loop)).rejects.toThrow();
    expect((await status(run.id))?.usage.inputTokens).toBe(211_000);
  });

  it("passes an edited decision to the model as the user's instruction", async () => {
    const { run, browser, loop, reload } = await setup([
      click(),
      doneExpecting("The user said instead: Use the archive button"),
    ]);
    browser.targets.set("10,20", risky("Delete account"));
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    await decideApproval(run.id, "edited", {
      instruction: "Use the archive button",
      budgetChoice: null,
    });
    const resumed = await reload();
    await resumed.resume(new AbortController().signal);
    expect(await drive(resumed)).toEqual({ kind: "completed" });
    expect(browser.executed).toEqual([]);
  });

  it("answers an interrupted act and the calls after it, and records act:aborted", async () => {
    const { run, browser, loop } = await setup([
      {
        outputs: [
          { type: "computer", actions: [{ type: "click", x: 10, y: 20, button: "left" }] },
          { type: "computer", actions: [{ type: "click", x: 30, y: 40, button: "left" }] },
        ],
      },
      doneExpecting("Interrupted: the user took control"),
    ]);
    browser.computerHook = async () => {
      throw new Interrupted("takeover");
    };
    await expect(drive(loop)).rejects.toBeInstanceOf(Interrupted);
    expect(await phases(run.id)).toContain("act:aborted");
    browser.computerHook = null;
    await loop.markTakeover();
    expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "takeover" });
    await loop.markHandBack();
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(browser.executed).toHaveLength(1);
    const last = JSON.stringify(mock.requests.at(-1)?.body.input);
    expect(last).toContain("Not run: the run was interrupted first.");
  });

  it("supersedes a pending item approval when the user takes control", async () => {
    const { run, browser, loop } = await setup([
      click(),
      doneExpecting("the user took control before approving"),
    ]);
    browser.targets.set("10,20", risky("Delete account"));
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    await loop.markTakeover();
    expect(loop.hasPendingApproval).toBe(false);
    expect((await approvalRows(run.id))[0]?.status).toBe("superseded");
    await loop.markHandBack();
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(browser.executed).toEqual([]);
  });

  it("a fresh worker rebuilds the identical model input from run_transcript (D37)", async () => {
    const turns = () => [click(), click(12, 20), done()];
    const straight = await setup(turns());
    expect(await drive(straight.loop)).toEqual({ kind: "completed" });
    const restarted = await setup(turns());
    for (let i = 0; i < 4; i++)
      expect(await restarted.loop.step(new AbortController().signal)).toEqual({ kind: "continue" });
    expect(await drive(await restarted.reload())).toEqual({ kind: "completed" });
    const normalize = (name: string, turn: number) =>
      JSON.stringify(mock.requestsFor(name)[turn]?.body.input)
        .replaceAll(/\b(call|cu|resp|msg|rs|enc)_[a-z0-9]+/g, "$1_X")
        .replaceAll(`[scenario:${name}]`, "[scenario:S]");
    for (const turn of [1, 2])
      expect(normalize(restarted.name, turn)).toBe(normalize(straight.name, turn));
  });

  it("sends only the newest 3 screenshots as images", async () => {
    const { name, browser, loop } = await setup([
      click(10),
      click(11),
      click(12),
      click(13),
      click(14),
      done(),
    ]);
    browser.png = Buffer.from("a distinct screenshot");
    expect(await drive(loop)).toEqual({ kind: "completed" });
    const last = JSON.stringify(mock.requestsFor(name).at(-1)?.body.input);
    const real = `data:image/png;base64,${browser.png.toString("base64")}`;
    expect(last.split(real).length - 1).toBe(3);
    expect(last).toContain("[screenshot omitted]");
  });

  it("sends a full run statelessly, anonymously and only to allowlisted endpoints (D38 guard)", async () => {
    const { name, loop } = await setup([
      { ...click(), usage: { input: 210_000 } },
      { outputs: [{ type: "reasoning", text: "thinking" }, ...click(11).outputs!] },
      done(),
    ]);
    expect(await drive(loop)).toEqual({ kind: "completed" });
    const requests = mock.requestsFor(name);
    // Agent turns plus a compaction summary, each checked on its own (not via file order).
    expect(requests.length).toBeGreaterThanOrEqual(4);
    expect(requests.some((r) => r.body.text?.format?.name === "compaction_summary")).toBe(true);
    expectPolicy(requests);
  });

  it("never calls the model while the user holds control (spec §10.3)", async () => {
    const { name, run, loop } = await setup([done()]);
    expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" }); // observe
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: "test-user" })
      .where(eq(runs.id, run.id));
    await expect(loop.step(new AbortController().signal)).rejects.toBeInstanceOf(ControlHeld);
    expect(mock.requestsFor(name)).toHaveLength(0);
    await owner.db
      .update(runs)
      .set({ controller: "agent", controlUserId: null })
      .where(eq(runs.id, run.id));
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(mock.requestsFor(name)).toHaveLength(1);
  });

  it("never calls the model once the worker's local lease deadline has passed (I2 residual)", async () => {
    let expired = false;
    const { name, loop } = await setup([done()], { leaseExpired: () => expired });
    expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" }); // observe
    expired = true;
    await expect(loop.step(new AbortController().signal)).rejects.toMatchObject({
      name: "Interrupted",
      why: "lease_lost",
    });
    expect(mock.requestsFor(name)).toHaveLength(0);
  });

  it("never calls the model for a compaction while the user holds control", async () => {
    const { name, run, loop } = await setup([{ ...click(), usage: { input: 210_000 } }, done()]);
    for (let i = 0; i < 4; i++)
      expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" });
    expect(mock.requestsFor(name)).toHaveLength(1);
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: "test-user" })
      .where(eq(runs.id, run.id));
    await loop.step(new AbortController().signal); // observe
    await expect(loop.step(new AbortController().signal)).rejects.toBeInstanceOf(ControlHeld);
    expect(mock.requestsFor(name)).toHaveLength(1);
  });

  it("carries this turn's user messages verbatim into the context after a compaction", async () => {
    const message = "Please do reading 2.4 next, not 2.5";
    const { name, run, loop } = await setup([
      { ...click(), usage: { input: 210_000 } },
      click(11),
      done(),
    ]);
    for (let i = 0; i < 4; i++)
      expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" });
    await owner.db.transaction((tx) =>
      emitRunEvent(tx, run.id, { type: "user_message", text: message }),
    );
    expect(await drive(loop)).toEqual({ kind: "completed" });
    const requests = mock.requestsFor(name);
    const turns = requests.filter((r) => r.body.text?.format?.name === "agent_turn");
    // The turn right after the compaction starts from the seed and still has the message verbatim,
    // and so does the next one (the message is part of the new base context, not only the summary).
    for (const turn of turns.slice(1)) {
      const input = JSON.stringify(turn.body.input);
      expect(input).toContain("continues from a summary");
      expect(input).toContain(`Message from the user: ${message}`);
    }
    expect(turns).toHaveLength(3);
  });

  describe("function-tool approvals (the tool's own approval request)", () => {
    const readPage: MockTurn = {
      outputs: [{ type: "function", name: "read_page", args: { mode: "text", sinceHash: null } }],
    };
    const firstUse = async () =>
      ({
        kind: "credential_first_use",
        alias: "school",
        origin: "http://site.fixtures.test",
      }) as const;

    it("asks for a function call's approval, then runs it once approved", async () => {
      const { run, browser, loop, reload } = await setup([readPage, doneExpecting("tool")]);
      browser.functionApproval = firstUse;
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      const [request] = await approvalRows(run.id);
      expect(request).toMatchObject({ kind: "credential_first_use", status: "pending" });
      expect(browser.functionRuns).toEqual([]);
      await decideApproval(run.id, "approved");
      const resumed = await reload();
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(browser.functionRuns).toEqual([
        { name: "read_page", args: { mode: "text", sinceHash: null } },
      ]);
    });

    it("answers a denied function call as not run and never runs it", async () => {
      const { run, browser, loop, reload } = await setup([
        readPage,
        doneExpecting("the user denied this action"),
      ]);
      browser.functionApproval = firstUse;
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      await decideApproval(run.id, "denied");
      const resumed = await reload();
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(browser.functionRuns).toEqual([]);
    });

    it("hands a human decision to the tool with who decided it and when (F4, W4)", async () => {
      const { run, browser, loop, reload } = await setup([readPage, done()]);
      browser.functionApproval = firstUse;
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      await decideApproval(run.id, "approved");
      const resumed = await reload();
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(browser.functionApprovals).toEqual([
        {
          kind: "credential_first_use",
          decidedBy: "user-1",
          label: null,
          decidedAt: expect.any(Number),
        },
      ]);
    });

    it("hands a policy decision to the tool as decided by policy (auto mode, D33)", async () => {
      const { browser, loop } = await setup([readPage, done()], {
        approvalMode: "auto_within_allowlist",
      });
      browser.functionApproval = firstUse;
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(browser.functionApprovals).toEqual([
        {
          kind: "credential_first_use",
          decidedBy: "policy",
          label: null,
          decidedAt: expect.any(Number),
        },
      ]);
    });

    it("binds each call's approval to the destination its own card named (T10-12 I1)", async () => {
      const twoFills: MockTurn = {
        outputs: [
          { type: "function", name: "read_page", args: { mode: "text", sinceHash: null } },
          { type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } },
        ],
      };
      const { run, browser, reload, ...first } = await setup([twoFills, done()]);
      let loop = first.loop;
      // Each call's card names where its own form posts.
      const shown = ["https://evil.example", "https://other.example"];
      browser.functionApproval = async (_name, args) => ({
        kind: "credential_first_use",
        alias: "school",
        origin: "http://site.fixtures.test",
        postsTo: (args as { mode: string }).mode === "text" ? shown[0] : shown[1],
      });
      for (let card = 0; card < 2; card++) {
        expect(await drive(loop), `card ${card}`).toEqual({ kind: "waiting", reason: "approval" });
        await decideApproval(run.id, "approved");
        loop = await reload();
        await loop.resume(new AbortController().signal);
      }
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(browser.functionApprovals.map((approval) => approval?.label)).toEqual(shown);
    });

    it("hands no approval to a call that needed none", async () => {
      const { browser, loop } = await setup([readPage, done()]);
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(browser.functionApprovals).toEqual([null]);
    });
  });

  it("treats a computer_call that carries no agent_turn message as continue, without a nudge (run 30)", async () => {
    const { browser, loop } = await setup([
      click(),
      {
        ...done(),
        check: (r) => {
          if (JSON.stringify(r.body.input).includes(NUDGE)) throw new Error("the loop nudged");
        },
      },
    ]);
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(browser.computerRuns).toHaveLength(1);
  });

  it("emits the pointer kind on computer step events (run view A1)", async () => {
    const { run, loop } = await setup([click(), done()]);
    expect(await drive(loop)).toEqual({ kind: "completed" });
    const actions = (
      await owner.db.select().from(runEvents).where(eq(runEvents.runId, run.id))
    ).flatMap((event) =>
      event.payload.type === "step" && event.payload.action ? [event.payload.action] : [],
    );
    expect(actions).toContainEqual(expect.objectContaining({ tool: "computer", pointer: "click" }));
  });

  it("enters waiting(otp) when a tool asks for a code; later calls of the turn do not run (F5)", async () => {
    const fillOtp: MockTurn = {
      outputs: [
        {
          type: "function",
          name: "fill_credential",
          args: { alias: "site", field: "otp", target: "e1" },
        },
        { type: "function", name: "read_page", args: { mode: "text", sinceHash: null } },
      ],
    };
    const { run, browser, loop } = await setup([fillOtp]);
    browser.functionWait = (name) => (name === "fill_credential" ? "otp" : null);
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "otp" });
    expect(browser.functionRuns.map((call) => call.name)).toEqual(["fill_credential"]);
    expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "otp" });
    expect(await loop.hasNews("otp")).toBe(false);
    await owner.sql`insert into otp_codes (run_id, sealed) values (${run.id}, ${Buffer.from([1])})`;
    expect(await loop.hasNews("otp")).toBe(true);
    expect(await loop.hasNews("captcha")).toBe(false);
  });

  it("puts the action and the cleaned record excerpt on the approval request (run view A2, A3a)", async () => {
    const { run, browser, loop } = await setup([click()]);
    browser.targets.set("10,20", { ...risky("Delete"), excerpt: "Alice‮  Smith\n row" });
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    const [row] = await approvalRows(run.id);
    expect(row?.request).toMatchObject({
      kind: "risky_click",
      action: { type: "click" },
      context: "Alice Smith row",
    });
  });

  it("carries the model's pending safety checks by code and message, with the action (A2)", async () => {
    const flagged: MockTurn = {
      outputs: [
        {
          type: "computer",
          actions: [{ type: "keypress", keys: ["ENTER"] }],
          safetyChecks: [
            { id: "sc_1", code: "malicious_instructions", message: "The page asks to ignore you" },
          ],
        },
      ],
    };
    const { run, loop } = await setup([flagged], { approvalMode: "auto_within_allowlist" });
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    const [row] = await approvalRows(run.id);
    expect(row?.request).toMatchObject({
      kind: "risky_click",
      action: { type: "keypress" },
      safetyChecks: [{ code: "malicious_instructions", message: "The page asks to ignore you" }],
    });
  });

  it("adds hooks.promptContext lines to the first request (F14)", async () => {
    let calls = 0;
    const promptContext = async () => {
      calls += 1;
      return ["Saved sign-ins: site (http://site.fixtures.test): username, password"];
    };
    const { loop } = await setup(
      [
        {
          ...click(),
          check: (r) => {
            if (!JSON.stringify(r.body.input).includes("Saved sign-ins: site"))
              throw new Error("no list");
          },
        },
        done(),
      ],
      { hooks: { promptContext } },
    );
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(calls).toBe(1);
  });

  it("reports executed clicks to hooks.onClick with the target's name and the page URL (F10)", async () => {
    const clicks: Array<{ label: string; url: string }> = [];
    const { browser, loop } = await setup([click(), done()], {
      hooks: { onClick: async (_run, clicked) => void clicks.push(clicked) },
    });
    browser.targets.set("10,20", { ...PLAIN_TARGET, label: "Log out", interactive: true });
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(clicks).toEqual([{ label: "Log out", url: "http://site.fixtures.test/" }]);
  });

  it("a takeover while an approval waits supersedes it and marks the run waiting(takeover) (A5)", async () => {
    const { run, browser, loop } = await setup([click()]);
    browser.targets.set("10,20", risky("Delete account"));
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    // The web flipped only the controller (status still waiting(approval)).
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: "test-user" })
      .where(eq(runs.id, run.id));
    await loop.markTakeover();
    expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "takeover" });
    expect((await approvalRows(run.id))[0]).toMatchObject({ status: "superseded" });
    expect(browser.computerRuns).toEqual([]);
  });

  it("a throwing onClick hook does not fail the run once the click has run (M4)", async () => {
    const { run, browser, loop } = await setup([click(), done()], {
      hooks: {
        onClick: async () => {
          throw new Error("vault unavailable");
        },
      },
    });
    expect(await drive(loop)).toEqual({ kind: "completed" });
    expect(browser.executed).toHaveLength(1);
    expect(await phases(run.id)).toContain("act:done");
  });

  describe("onClick reports only clicks that ran (M5)", () => {
    const batch: MockTurn = {
      outputs: [
        {
          type: "computer",
          actions: [
            { type: "click", x: 10, y: 20, button: "left" },
            { type: "click", x: 30, y: 40, button: "left" },
          ],
        },
      ],
    };
    const plain = (label: string) => ({ ...PLAIN_TARGET, label, interactive: true });

    it("skips a click the executor held at dispatch", async () => {
      const clicks: string[] = [];
      const { browser, loop } = await setup([batch, done()], {
        hooks: { onClick: async (_run, clicked) => void clicks.push(clicked.label) },
      });
      browser.targets.set("10,20", plain("Home"));
      browser.targets.set("30,40", plain("Log out"));
      browser.dispatchHold = (action) => action.type === "click" && action.x === 30;
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(clicks).toEqual(["Home"]);
    });

    it("skips a click the user refused", async () => {
      const clicks: string[] = [];
      const { run, browser, loop, reload } = await setup([batch, done()], {
        hooks: { onClick: async (_run, clicked) => void clicks.push(clicked.label) },
      });
      browser.targets.set("10,20", plain("Home"));
      browser.targets.set("30,40", risky("Delete account"));
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      await decideApproval(run.id, "denied");
      const resumed = await reload();
      await resumed.resume(new AbortController().signal);
      expect(await drive(resumed)).toEqual({ kind: "completed" });
      expect(clicks).toEqual(["Home"]);
    });
  });

  it("waits for a takeover when the executor hands the page to the user, and runs nothing after (breaker fix 2)", async () => {
    const twoCalls: MockTurn = {
      outputs: [
        { type: "computer", actions: [{ type: "click", x: 10, y: 20, button: "left" }] },
        { type: "computer", actions: [{ type: "click", x: 30, y: 40, button: "left" }] },
      ],
    };
    const { run, browser, loop } = await setup([twoCalls, done()]);
    browser.handOverOn = (action) =>
      action.type === "click" && action.x === 10 ? "Too many frames: please take over." : null;
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "takeover" });
    expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "takeover" });
    expect(browser.executed).toEqual([]);
  });

  it("a takeover revert announces control{agent} only when it took control back (B6 A2)", async () => {
    const controlEvents = async (runId: string) =>
      (await owner.db.select().from(runEvents).where(eq(runEvents.runId, runId)))
        .map((e) => e.payload)
        .filter((p) => p.type === "control" || p.type === "error");
    const held = await setup([done()]);
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: "test-user" })
      .where(eq(runs.id, held.run.id));
    await held.loop.revertTakeover();
    expect((await controlEvents(held.run.id)).map((e) => e.type).sort()).toEqual([
      "control",
      "error",
    ]);
    // The user handed back first (the web already wrote controller='agent'): no second control{agent}.
    const handedBack = await setup([done()]);
    await handedBack.loop.revertTakeover();
    expect((await controlEvents(handedBack.run.id)).map((e) => e.type)).toEqual(["error"]);
    expect(await status(handedBack.run.id)).toMatchObject({
      controller: "agent",
      status: "running",
    });
  });

  describe("one-time code and CAPTCHA waits (M6, M7)", () => {
    const fillOtp: MockTurn = {
      outputs: [
        {
          type: "function",
          name: "fill_credential",
          args: { alias: "site", field: "otp", target: "e1" },
        },
      ],
    };
    const waitingForCode = async () => {
      const ctx = await setup([fillOtp, done()]);
      ctx.browser.functionWait = (name) => (name === "fill_credential" ? "otp" : null);
      return ctx;
    };
    // Takeover and hand-back go through the web's real writes (B6 A4), not a fixture update.
    let member: { userId: string };
    beforeAll(async () => {
      member = await seedMember(owner.db, { workspaceId });
    });
    const takeOver = async (runId: string) =>
      expect(await requestTakeover(owner.db, { runId, userId: member.userId })).toEqual({
        ok: true,
        via: "control",
      });
    const handBack = async (runId: string) =>
      expect(await requestHandBack(owner.db, { runId, userId: member.userId, note: null })).toEqual(
        { ok: true, via: "control" },
      );

    it("a new origin blocked in the same act does not discard the code wait (M6)", async () => {
      const { run, browser, loop } = await waitingForCode();
      browser.blocked.push({
        url: "http://other.fixtures.test/x",
        origin: "http://other.fixtures.test",
      });
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "otp" });
      expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "otp" });
      expect((await approvalRows(run.id)).map((row) => row.kind)).not.toContain("new_origin");
    });

    it("a takeover keeps waiting(otp); hand-back re-observes and runs on, so a code typed on the page counts (M7, F1)", async () => {
      const { run, browser, loop } = await waitingForCode();
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "otp" });
      await takeOver(run.id);
      await loop.markTakeover();
      expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "otp" });
      // The person typed the code into the page themselves: no otp_codes row exists.
      browser.functionWait = () => null;
      await handBack(run.id);
      await loop.markHandBack();
      expect(await status(run.id)).toMatchObject({ status: "running" });
      expect(await drive(loop)).toEqual({ kind: "completed" });
    });

    it("after hand-back, a page that still asks for a code waits for one again (M7, F1)", async () => {
      const { run, browser, loop } = await setup([fillOtp, fillOtp, done()]);
      browser.functionWait = (name) => (name === "fill_credential" ? "otp" : null);
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "otp" });
      await takeOver(run.id);
      await loop.markTakeover();
      await handBack(run.id);
      await loop.markHandBack();
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "otp" });
      expect(browser.functionRuns.map((call) => call.name)).toEqual([
        "fill_credential",
        "fill_credential",
      ]);
    });

    it("hand-back runs on when a code was submitted during the takeover (M7)", async () => {
      const { run, loop } = await waitingForCode();
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "otp" });
      await takeOver(run.id);
      await loop.markTakeover();
      await owner.sql`insert into otp_codes (run_id, sealed) values (${run.id}, ${Buffer.from([1])})`;
      await handBack(run.id);
      await loop.markHandBack();
      expect(await status(run.id)).toMatchObject({ status: "running" });
      expect(await drive(loop)).toEqual({ kind: "completed" });
    });

    it("a takeover keeps waiting(captcha); hand-back re-observes and waits again while it shows (M7)", async () => {
      const { run, browser, loop } = await setup([done()]);
      browser.captcha = true;
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "captcha" });
      await takeOver(run.id);
      await loop.markTakeover();
      expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "captcha" });
      await handBack(run.id);
      await loop.markHandBack();
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "captcha" });
      expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "captcha" });
    });
  });

  it("hands the page to a person when a tool says only a person can decide (needs_human)", async () => {
    const twoCalls: MockTurn = {
      outputs: [
        {
          type: "function",
          name: "fill_credential",
          args: { alias: "site", field: "password", target: "e1" },
        },
        { type: "function", name: "read_page", args: { mode: "text", sinceHash: null } },
      ],
    };
    const { run, browser, loop } = await setup([twoCalls]);
    browser.functionHandOver = (name) =>
      name === "fill_credential" ? "This form sends the password to another site" : null;
    expect(await drive(loop)).toEqual({ kind: "waiting", reason: "takeover" });
    expect(browser.functionRuns.map((call) => call.name)).toEqual(["fill_credential"]);
    expect(await status(run.id)).toMatchObject({ status: "waiting", waitReason: "takeover" });
  });
  describe("bypass mode (D44)", () => {
    const bypass = { approvalMode: "bypass" as const };
    const readPage: MockTurn = {
      outputs: [{ type: "function", name: "read_page", args: { mode: "text", sinceHash: null } }],
    };
    const firstUse = async () =>
      ({
        kind: "credential_first_use",
        alias: "school",
        origin: "http://site.fixtures.test",
      }) as const;

    it("approves a risky click, a new origin and a download without asking, each recorded as bypass", async () => {
      const { run, browser, loop } = await setup(
        [click(), doneExpecting("allowed by this run's bypass mode")],
        bypass,
      );
      browser.targets.set("10,20", risky("Delete account"));
      browser.computerHook = async () => {
        browser.blocked.push({
          url: "http://other.fixtures.test/a",
          origin: "http://other.fixtures.test",
        });
        browser.blockedDownloads.push({
          url: "http://site.fixtures.test/files/r.csv",
          filename: "r.csv",
        });
      };
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(browser.executed).toHaveLength(1);
      expect(browser.navigations).toEqual(["http://other.fixtures.test/a"]);
      expect(browser.allowedDownloads).toEqual(["http://site.fixtures.test/files/r.csv"]);
      expect(
        (await approvalRows(run.id)).map((row) => [row.kind, row.status, row.decidedBy]),
      ).toEqual([
        ["risky_click", "approved", "bypass"],
        ["new_origin", "approved", "bypass"],
        ["download", "approved", "bypass"],
      ]);
      expect((await status(run.id))?.allowedOrigins).toContain("http://other.fixtures.test");
    });

    it("still waits for a person on a prompt-injection safety check (malicious_instructions)", async () => {
      const flagged: MockTurn = {
        outputs: [
          {
            type: "computer",
            actions: [{ type: "click", x: 10, y: 20, button: "left" }],
            safetyChecks: [{ id: "sc_1", code: "malicious_instructions", message: "Flagged" }],
          },
        ],
      };
      const { run, browser, loop } = await setup([flagged, done()], bypass);
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
      expect(browser.executed).toEqual([]);
      expect(await approvalRows(run.id)).toMatchObject([{ status: "pending", decidedBy: null }]);
    });

    it("never counts as a person's approval: tools see a policy decision (no lasting vault grant, an off-origin form still needs a person), and the click guard is not relaxed", async () => {
      const { run, browser, loop } = await setup([readPage, click(), done()], bypass);
      browser.functionApproval = firstUse;
      browser.targets.set("10,20", risky("Delete account"));
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(browser.functionApprovals).toEqual([
        {
          kind: "credential_first_use",
          decidedBy: "policy",
          label: null,
          decidedAt: expect.any(Number),
        },
      ]);
      expect(browser.verdicts).toMatchObject([{ personApproved: false }]);
      expect((await approvalRows(run.id)).every((row) => row.decidedBy === "bypass")).toBe(true);
    });

    it("still stops for the user: never calls the model while the user holds control", async () => {
      const { name, run, loop } = await setup([done()], bypass);
      expect(await loop.step(new AbortController().signal)).toEqual({ kind: "continue" });
      await owner.db
        .update(runs)
        .set({ controller: "user", controlUserId: "test-user" })
        .where(eq(runs.id, run.id));
      await expect(loop.step(new AbortController().signal)).rejects.toBeInstanceOf(ControlHeld);
      expect(mock.requestsFor(name)).toHaveLength(0);
    });

    it("still waits for a person at a budget hit (a spending cap, not an action)", async () => {
      const { loop } = await setup([click(), click(), done()], {
        ...bypass,
        budget: { maxSteps: 1, maxUsd: 5, maxActiveMinutes: 60 },
      });
      expect(await drive(loop)).toEqual({ kind: "waiting", reason: "approval" });
    });
  });
});
