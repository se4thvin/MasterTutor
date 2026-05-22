import {
  encodeNotify,
  type ApprovalEdit,
  type ApprovalMode,
  type RunEvent,
} from "@mastertutor/contracts";
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
import { and, asc, eq, sql } from "drizzle-orm";
import { createOpenAIModelClient } from "../../apps/agent/src/llm/client.ts";
import { Supervisor } from "../../apps/agent/src/loop/supervisor.ts";
import { instantClock, type Clock } from "../../apps/agent/src/runtime/clock.ts";
import type { RuntimeConfig } from "../../apps/agent/src/runtime/config.ts";
import { seedWorkspace } from "../../apps/agent/src/testing/db.ts";
import { crashSupervisor } from "../../apps/agent/src/testing/crash.ts";
import { createMemoryStorage } from "../../apps/agent/src/testing/memory-storage.ts";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import type { Scenario } from "../llm-mock/src/scenario.ts";
import { startLlmMock, type LlmMock } from "../llm-mock/src/server.ts";
import { BEHAVIOUR_DOWNLOADS, BEHAVIOUR_SLOTS, SITE, cdpBaseUrlForTests } from "./constants.ts";
import { behaviourEnv } from "./env.ts";

const log = createLogger({ service: "behaviour", level: "silent" });

/**
 * One agent per test FILE (ruling): every Supervisor start recycles slots, and frequent slot
 * container restarts trip Docker's restart backoff. Tests add their scenarios to the shared mock.
 */
export interface BehaviourAgent {
  supervisor: Supervisor;
  mock: LlmMock;
  owner: DbHandle;
  web: DbHandle;
  /** The agent's object store (screenshots), for assertions on stored images. */
  storage: ReturnType<typeof createMemoryStorage>;
  workspaceId: string;
  stop(): Promise<void>;
  crash(): Promise<void>;
  restart(): Promise<void>;
}

const slotsIdle = async (owner: DbHandle) =>
  (await owner.db.select().from(browserSlots).where(eq(browserSlots.state, "idle"))).length ===
  BEHAVIOUR_SLOTS.length;

export async function startBehaviourAgent(
  options: { scenarios?: Scenario[]; config?: Partial<RuntimeConfig>; clock?: Clock } = {},
): Promise<BehaviourAgent> {
  const env = behaviourEnv();
  const owner = createDb(env.ownerUrl);
  const web = createDb(env.webUrl);
  const mock = await startLlmMock({ scenarios: options.scenarios ?? [] });
  const storage = createMemoryStorage();
  const [existing] = await owner.db.select({ id: settings.workspaceId }).from(settings).limit(1);
  const workspaceId = existing?.id ?? (await seedWorkspace(owner.db));
  await owner.db.update(settings).set({ killSwitch: false });
  let agentDb = createDb(env.agentUrl);
  const make = () =>
    new Supervisor({
      db: agentDb,
      storage,
      model: createOpenAIModelClient({ apiKey: "behaviour", baseURL: `${mock.url}/v1` }),
      slots: [...BEHAVIOUR_SLOTS],
      cdpBaseUrl: cdpBaseUrlForTests,
      log,
      testMode: true,
      clock: options.clock ?? instantClock(),
      config: {
        leaseMs: 3_000,
        heartbeatMs: 1_000,
        sweepMs: 500,
        downloadsDir: BEHAVIOUR_DOWNLOADS,
        // The next file must start on idle slots: wait for every restart (production bounds this).
        shutdownDrainMs: 90_000,
        ...options.config,
      },
    });
  const agent: BehaviourAgent = {
    supervisor: make(),
    mock,
    owner,
    web,
    storage,
    workspaceId,
    stop: async () => {
      // stop() waits for slot restarts in flight, so the next file starts on idle slots.
      await agent.supervisor.stop();
      await mock.close();
      await owner.close();
      await web.close();
    },
    // A true crash: the DB closes first, so the in-flight act keeps no abort row.
    crash: () => crashSupervisor(agent.supervisor, agentDb),
    restart: async () => {
      agentDb = createDb(env.agentUrl);
      agent.supervisor = make();
      await agent.supervisor.start();
    },
  };
  await agent.supervisor.start();
  await waitFor(() => slotsIdle(owner), {
    label: "behaviour slots idle",
    timeoutMs: 90_000,
    intervalMs: 250,
  });
  return agent;
}

/** Inserts through web_role and NOTIFYs run_queued, as the web app does (Task 18 web contract). */
export async function createRun(
  agent: BehaviourAgent,
  goal: string,
  options: { approvalMode?: ApprovalMode; allowedOrigins?: string[] } = {},
): Promise<string> {
  const [run] = await agent.web.db
    .insert(runs)
    .values({
      workspaceId: agent.workspaceId,
      goal,
      allowedOrigins: options.allowedOrigins ?? [SITE],
      approvalMode: options.approvalMode ?? "ask",
    })
    .returning({ id: runs.id });
  await agent.web.sql.notify("run_queued", encodeNotify("run_queued", { runId: run!.id }));
  return run!.id;
}

export async function waitForRun(
  agent: BehaviourAgent,
  runId: string,
  test: (run: typeof runs.$inferSelect) => boolean,
  label: string,
  timeoutMs = 60_000,
) {
  return waitFor(
    async () => {
      const [run] = await agent.owner.db.select().from(runs).where(eq(runs.id, runId));
      return run && test(run) ? run : null;
    },
    { label, timeoutMs, intervalMs: 50 },
  );
}

export async function decideApproval(
  agent: BehaviourAgent,
  runId: string,
  status: "approved" | "denied" | "edited",
  edit?: ApprovalEdit,
) {
  await agent.web.db
    .update(approvals)
    .set({ status, decidedBy: "behaviour-user", decidedAt: sql`now()`, edit: edit ?? null })
    .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")));
  await agent.web.db
    .update(runs)
    .set({ wakeRequestedAt: sql`now()` })
    .where(eq(runs.id, runId));
  await agent.web.sql.notify("run_wake", encodeNotify("run_wake", { runId, reason: "approval" }));
}

/** Returns the database time of the takeover, for latency measured on the step rows' clock. */
export async function takeControl(agent: BehaviourAgent, runId: string): Promise<Date> {
  const [row] = await agent.web.db
    .update(runs)
    .set({
      controller: "user",
      controlUserId: "behaviour-user",
      status: "waiting",
      waitReason: "takeover",
    })
    .where(eq(runs.id, runId))
    .returning({ at: sql<string>`now()::text` });
  await agent.web.sql.notify("run_control", encodeNotify("run_control", { runId }));
  return new Date(row!.at);
}

export async function handBack(agent: BehaviourAgent, runId: string) {
  await agent.web.db
    .update(runs)
    .set({ controller: "agent", controlUserId: null })
    .where(eq(runs.id, runId));
  await agent.web.sql.notify("run_control", encodeNotify("run_control", { runId }));
}

/** Returns the database time of the switch. */
export async function killSwitch(agent: BehaviourAgent, on: boolean): Promise<Date> {
  const [row] = await agent.web.db
    .update(settings)
    .set({ killSwitch: on })
    .where(eq(settings.workspaceId, agent.workspaceId))
    .returning({ at: sql<string>`now()::text` });
  if (on)
    await agent.web.sql.notify(
      "run_wake",
      encodeNotify("run_wake", { runId: null, reason: "kill" }),
    );
  return new Date(row!.at);
}

export const steps = (agent: BehaviourAgent, runId: string) =>
  agent.owner.db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.seq));
export const events = async (agent: BehaviourAgent, runId: string): Promise<RunEvent[]> =>
  (
    await agent.owner.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
  ).map((row) => row.payload);
export const slotIdle = async (agent: BehaviourAgent, name: string) =>
  (await agent.owner.db.select().from(browserSlots).where(eq(browserSlots.name, name)))[0]
    ?.state === "idle";
/** The slot a run was given (its first `slot` event). */
export const slotOf = async (agent: BehaviourAgent, runId: string): Promise<string | null> => {
  for (const event of await events(agent, runId))
    if (event.type === "slot" && event.slotName) return event.slotName;
  return null;
};
