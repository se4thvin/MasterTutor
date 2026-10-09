import {
  PersonDecider,
  type ApprovalMode,
  type Budget,
  type ToolProfile,
  type ObserverMode,
  type RunEvent,
} from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import {
  approvals,
  createDb,
  guardReviews,
  loadGuardLedger,
  runEvents,
  runSteps,
  runs,
  type DbHandle,
} from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import type { MockTurn } from "../../../../../tests/llm-mock/src/scenario.ts";
import { startLlmMock, type LlmMock } from "../../../../../tests/llm-mock/src/server.ts";
import { ModelCaller } from "../../llm/caller.ts";
import { FORBIDDEN_RESPONSE_FIELDS } from "../../llm/openai.ts";
import { createOpenAIModelClient } from "../../llm/client.ts";
import type { RunTitler } from "../../llm/run-title.ts";
import { instantClock } from "../../runtime/clock.ts";
import { runtimeConfig } from "../../runtime/config.ts";
import { insertRun, seedWorkspace } from "../../testing/db.ts";
import { FakeLoopBrowser } from "../../testing/fake-loop-browser.ts";
import { createMemoryStorage } from "../../testing/memory-storage.ts";
import { withHooks, type RunHooks } from "../hooks.ts";
import { RunLoop, type StepOutcome } from "../run-loop.ts";
import { snapshotOf } from "../run-state.ts";
import { NO_SESSION_STORE, StepStore } from "../step-store.ts";
import type { StepGuardFactory } from "../../guardrails/observer/types.ts";
export const log = createLogger({ service: "test", level: "silent" });
export const OWNER = "loop-test";
export let database: TestDatabase;
export let owner: DbHandle;
export let agent: DbHandle;
export let mock: LlmMock;
export let workspaceId: string;
export let counter = 0;

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
export function expectPolicy(requests: typeof mock.requests): void {
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

export const done = (reason = "Finished"): MockTurn => ({
  outputs: [{ type: "turn", status: "done", reason }],
});
export const click = (x = 10, y = 20): MockTurn => ({
  outputs: [{ type: "computer", actions: [{ type: "click", x, y, button: "left" }] }],
});
export const doneExpecting = (text: string): MockTurn => ({
  outputs: [{ type: "turn", status: "done", reason: "ok" }],
  check: (r) => {
    if (!JSON.stringify(r.body.input).includes(text)) throw new Error(`no "${text}" in the input`);
  },
});
export const risky = (label: string, path = `button:${label}`, context = "page") => ({
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

export async function setup(
  turns: MockTurn[],
  options: {
    approvalMode?: ApprovalMode;
    toolProfile?: ToolProfile;
    budget?: Budget;
    hooks?: Partial<RunHooks>;
    leaseExpired?: () => boolean;
    allowedOrigins?: string[];
    titler?: RunTitler;
    guards?: StepGuardFactory;
    observerMode?: ObserverMode;
  } = {},
) {
  const name = `s${++counter}`;
  mock.setScenarios([{ name, turns }]);
  const row = await insertRun(owner.db, {
    workspaceId,
    goal: `[scenario:${name}] Do the task`,
    allowedOrigins: options.allowedOrigins,
    status: "running",
    leaseOwner: OWNER,
    approvalMode: options.approvalMode,
    observerMode: options.observerMode,
    toolProfile: options.toolProfile,
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
    ...(options.guards ? { guards: options.guards } : {}),
    ...(options.titler ? { titler: options.titler } : {}),
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

export async function drive(loop: RunLoop, max = 60): Promise<StepOutcome> {
  for (let i = 0; i < max; i++) {
    const outcome = await loop.step(new AbortController().signal);
    if (outcome.kind !== "continue") return outcome;
  }
  throw new Error("the loop did not stop");
}

export const phases = async (runId: string) =>
  (
    await owner.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .orderBy(asc(runSteps.seq))
  ).map((s) => `${s.phase}:${s.state}`);
export const status = async (runId: string) =>
  (await owner.db.select().from(runs).where(eq(runs.id, runId)))[0];
export const approvalRows = (runId: string) =>
  owner.db
    .select()
    .from(approvals)
    .where(eq(approvals.runId, runId))
    .orderBy(asc(approvals.createdAt));
/** Decides the pending approval(s) only; earlier decisions stay as they were. */
export const decideApproval = (
  runId: string,
  outcome: "approved" | "denied" | "edited",
  edit: unknown = null,
) =>
  owner.db
    .update(approvals)
    .set({ status: outcome, decidedBy: PersonDecider.parse("user-1"), edit: edit as never })
    .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")));

export function harness() {
  return {
    get mock() {
      return mock;
    },
    setup,
    events: async (runId: string, type: RunEvent["type"]) =>
      (
        await owner.db
          .select()
          .from(runEvents)
          .where(and(eq(runEvents.runId, runId), eq(runEvents.type, type)))
          .orderBy(asc(runEvents.id))
      ).map((row) => row.payload),
    guardReviews: (runId: string) =>
      owner.db
        .select()
        .from(guardReviews)
        .where(eq(guardReviews.runId, runId))
        .orderBy(asc(guardReviews.createdAt)),
    ledger: (runId: string) => loadGuardLedger(agent.db, runId),
  };
}
