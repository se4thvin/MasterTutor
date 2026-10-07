import type { RunEvent } from "@mastertutor/contracts";
import { createLogger, deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { createDb, type DbHandle } from "@mastertutor/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockTurn } from "../../../../tests/llm-mock/src/scenario.ts";
import {
  BEHAVIOUR_DOWNLOADS,
  BEHAVIOUR_NEKO_ADMIN_SECRET,
  BEHAVIOUR_NEKO_MEMBER_SECRET,
  SITE,
  idleUrlForTests,
  nekoBaseUrlForTests,
} from "../../../../tests/behaviour/constants.ts";
import { behaviourEnv } from "../../../../tests/behaviour/env.ts";
import {
  createRun,
  events,
  slotOf,
  startBehaviourAgent,
  steps,
  takeControl,
  waitForRun,
  type BehaviourAgent,
} from "../../../../tests/behaviour/harness.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { waitFor } from "../testing/wait.ts";
import { createDownloadIngestor } from "./downloads.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createLiveHooks, liveControlStore } from "./live-hooks.ts";
import { createNekoAdmin } from "./neko-admin.ts";
import { createNekoLiveView } from "./neko-live-view.ts";

const log = createLogger({ service: "behaviour", level: "silent" });
const admin = createNekoAdmin({
  adminSecret: BEHAVIOUR_NEKO_ADMIN_SECRET,
  baseUrl: (slot) => nekoBaseUrlForTests(slot),
});
let agentDb: DbHandle;
let agent: BehaviourAgent;
let socket: WebSocket | undefined;

beforeAll(async () => {
  agentDb = createDb(behaviourEnv().agentUrl, { max: 2 });
  agent = await startBehaviourAgent({
    hooks: createLiveHooks({
      store: liveControlStore(agentDb.db),
      liveView: createNekoLiveView({ admin }),
      idleProbe: createSlotIdleProbe({ url: (slot) => idleUrlForTests(slot) }),
      downloads: createDownloadIngestor({
        db: agentDb.db,
        storage: createMemoryStorage(),
        log,
        localRoot: BEHAVIOUR_DOWNLOADS,
        dirMode: 0o777,
      }),
      log,
      idleLimitMs: 1_500,
      idlePollMs: 200,
    }),
  });
});
afterAll(async () => {
  socket?.close();
  await agent?.stop();
  await agentDb?.close();
});

const turn = (outputs: MockTurn["outputs"]): MockTurn => ({ outputs });

describe("15-minute idle hand-back, with a 1.5 s limit (spec §5.1)", () => {
  it("returns control to the agent when the user gives no input, and the run goes on", async () => {
    agent.mock.setScenarios([
      {
        name: "idle",
        turns: [
          turn([
            { type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } },
          ]),
          turn([{ type: "click_named", name: "Notes" }]),
          turn([{ type: "computer", actions: [{ type: "type", text: "y".repeat(5_000) }] }]),
          turn([{ type: "turn", status: "done", reason: "Finished" }]),
        ],
      },
    ]);
    const runId = await createRun(agent, `[scenario:idle] ${SITE}/interactive.html`);
    await waitFor(
      async () =>
        (await steps(agent, runId)).some((s) => s.phase === "act" && s.state === "started"),
      { label: "acting", timeoutMs: 60_000, intervalMs: 10 },
    );
    const slot = (await slotOf(agent, runId))!;
    const base = nekoBaseUrlForTests(slot);
    const token = await loginNeko({
      baseUrl: base,
      username: "user",
      password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, slot),
    });
    socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve());
      socket!.addEventListener("error", () => reject(new Error("n.eko websocket failed")));
    });
    const takenAt = performance.now();
    await takeControl(agent, runId);
    const held = (e: RunEvent) => e.type === "control" && e.holder === "user";
    await waitFor(async () => (await events(agent, runId)).some(held), { label: "user holds" });
    await waitFor(
      async () =>
        (await events(agent, runId)).some((e) => e.type === "error" && e.code === "idle_hand_back"),
      { label: "idle hand-back", timeoutMs: 10_000 },
    );
    expect(performance.now() - takenAt).toBeGreaterThanOrEqual(1_500);
    await waitForRun(agent, runId, (run) => run.controller === "agent", "agent holds again");
    expect(
      ((await admin.request(slot, "GET", "/api/room/control")) as { host_id?: string }).host_id,
    ).toBe("agent");
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed");
  });
});
