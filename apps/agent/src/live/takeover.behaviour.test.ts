import { encodeNotify, type RunEvent } from "@mastertutor/contracts";
import { createLogger, deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { createDb, runs, type DbHandle } from "@mastertutor/db";
import { eq } from "drizzle-orm";
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
  handBack,
  slotOf,
  startBehaviourAgent,
  steps,
  takeControl,
  waitForRun,
  type BehaviourAgent,
} from "../../../../tests/behaviour/harness.ts";
import { xdotool } from "../../../../tests/behaviour/slot-tools.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { waitFor } from "../testing/wait.ts";
import { createDownloadIngestor } from "./downloads.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createLiveHooks, liveControlStore } from "./live-hooks.ts";
import type { LiveView } from "./live-view.ts";
import { createNekoAdmin } from "./neko-admin.ts";
import { createNekoLiveView } from "./neko-live-view.ts";

const log = createLogger({ service: "behaviour", level: "silent" });
const admin = createNekoAdmin({
  adminSecret: BEHAVIOUR_NEKO_ADMIN_SECRET,
  baseUrl: (slot) => nekoBaseUrlForTests(slot),
});
const real = createNekoLiveView({ admin });
/** Database-clock marks of every give (after it completed) and take (before it started), for W6. */
const marks: Array<{ kind: "give" | "take"; slot: string; at: Date }> = [];
let agentDb: DbHandle;
let owner: DbHandle;
let agent: BehaviourAgent;
const sockets: WebSocket[] = [];

const dbNow = async () =>
  new Date(String((await owner.sql<Array<{ now: string }>>`select now()::text as now`)[0]!.now));
const recorded: LiveView = {
  async giveControl(slot, userId) {
    await real.giveControl(slot, userId);
    marks.push({ kind: "give", slot: slot.name, at: await dbNow() });
  },
  async takeControl(slot) {
    marks.push({ kind: "take", slot: slot.name, at: await dbNow() });
    await real.takeControl(slot);
  },
  setClipboardAccess: (slot, on) => real.setClipboardAccess(slot, on),
};

beforeAll(async () => {
  const env = behaviourEnv();
  owner = createDb(env.ownerUrl, { max: 2 });
  agentDb = createDb(env.agentUrl, { max: 2 });
  agent = await startBehaviourAgent({
    hooks: createLiveHooks({
      store: liveControlStore(agentDb.db),
      liveView: recorded,
      idleProbe: createSlotIdleProbe({ url: (slot) => idleUrlForTests(slot) }),
      downloads: createDownloadIngestor({
        db: agentDb.db,
        storage: createMemoryStorage(),
        log,
        localRoot: BEHAVIOUR_DOWNLOADS,
        dirMode: 0o777,
      }),
      log,
    }),
  });
});
afterAll(async () => {
  for (const socket of sockets) socket.close();
  await agent?.stop();
  await Promise.all([owner?.close(), agentDb?.close()]);
});

const scenario = (name: string, turns: MockTurn[]) => {
  agent.mock.setScenarios([{ name, turns }]);
  return name;
};
const readInteractive: MockTurn = {
  outputs: [
    { type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } },
  ],
};
const clickNotes: MockTurn = { outputs: [{ type: "click_named", name: "Notes" }] };
const typeLong: MockTurn = {
  outputs: [{ type: "computer", actions: [{ type: "type", text: "y".repeat(5_000) }] }],
};
const done: MockTurn = { outputs: [{ type: "turn", status: "done", reason: "Finished" }] };
const isTyping = (action: unknown) =>
  ((action as { summary?: string } | null)?.summary ?? "").startsWith("type");
const typingStarted = (runId: string) =>
  waitFor(
    async () =>
      (await steps(agent, runId)).some(
        (s) => s.phase === "act" && s.state === "started" && isTyping(s.action),
      ),
    { label: "typing", timeoutMs: 60_000, intervalMs: 10 },
  );
const controlEvents = async (runId: string) =>
  (await events(agent, runId)).flatMap((e: RunEvent) => (e.type === "control" ? [e.holder] : []));
const hostOf = async (slot: string) =>
  ((await admin.request(slot, "GET", "/api/room/control")) as { host_id?: string }).host_id;
const userCanHost = async (slot: string) =>
  ((await admin.request(slot, "GET", "/api/members/user")) as { can_host?: boolean }).can_host;
/** What the iframe does: openLive's server-side login, then the n.eko websocket. */
async function connectLiveView(slot: string): Promise<string> {
  return (await openViewer(slot)).token;
}
async function openViewer(slot: string): Promise<{ token: string; socket: WebSocket }> {
  const base = nekoBaseUrlForTests(slot);
  const token = await loginNeko({
    baseUrl: base,
    username: "user",
    password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, slot),
  });
  const socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("n.eko websocket failed")));
  });
  return { token, socket };
}
/** The X pointer of the slot's display (where n.eko's XTest input lands). */
const pointer = async (slot: string) =>
  (await xdotool(slot, "getmouselocation", "--shell"))
    .split("\n")
    .filter((line) => /^[XY]=/.test(line))
    .join(" ");
const closeLiveViews = () => {
  for (const socket of sockets.splice(0)) socket.close();
};

describe("takeover through B1's lock with the n.eko live view (spec §10.3, §12)", () => {
  it("seats the agent as n.eko host at lease, so the user cannot take the browser (A1, S2)", async () => {
    const name = scenario("seat", [readInteractive, clickNotes, typeLong, done]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const slot = (await slotOf(agent, runId))!;
    expect(await hostOf(slot)).toBe("agent");
    const token = await loginNeko({
      baseUrl: nekoBaseUrlForTests(slot),
      username: "user",
      password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, slot),
    });
    const request = await fetch(`${nekoBaseUrlForTests(slot)}/api/room/control/request`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(request.status).toBe(403);
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed");
  });

  it("ignores input from a connected viewer who is not host (as before a takeover is given)", async () => {
    closeLiveViews();
    const name = scenario("pending", [readInteractive, clickNotes, typeLong, done]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const slot = (await slotOf(agent, runId))!;
    const { socket } = await openViewer(slot);
    // Until the agent gives control (a requested takeover not yet given included), n.eko has the
    // agent as host, so whatever the live view sends must not reach X.
    expect(await hostOf(slot)).toBe("agent");
    const before = await pointer(slot);
    for (const [x, y] of [
      [3, 3],
      [640, 400],
      [1200, 700],
    ])
      socket.send(JSON.stringify({ event: "control/move", payload: { x, y } }));
    socket.send(
      JSON.stringify({ event: "control/buttonpress", payload: { code: 1, x: 640, y: 400 } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await pointer(slot)).toBe(before);
    expect(await hostOf(slot)).toBe("agent");
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed");
    closeLiveViews();
  });

  it("a takeover with no live view connected fails, and the agent keeps control (Review Focus 1)", async () => {
    closeLiveViews();
    const name = scenario("no-view", [readInteractive, clickNotes, typeLong, done]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const slot = (await slotOf(agent, runId))!;
    await takeControl(agent, runId);
    await waitFor(
      async () =>
        (await events(agent, runId)).some(
          (e) => e.type === "error" && e.code === "takeover_failed",
        ),
      { label: "takeover_failed", timeoutMs: 5_000 },
    );
    expect(await controlEvents(runId)).toEqual(["agent"]);
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, runId));
    expect(row).toMatchObject({ controller: "agent", controlUserId: null });
    expect(await hostOf(slot)).toBe("agent");
    expect(await userCanHost(slot)).toBe(false);
    await waitForRun(
      agent,
      runId,
      (run) => run.status === "completed",
      "completed without hand back",
    );
  });

  it("gives n.eko to a connected live view, and never lets agent input overlap it (W6, base Review Focus 5)", async () => {
    const name = scenario("toggle", [
      readInteractive,
      clickNotes,
      typeLong,
      typeLong,
      typeLong,
      typeLong,
      done,
    ]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const slot = (await slotOf(agent, runId))!;
    const viewer = await openViewer(slot);

    await takeControl(agent, runId);
    await waitFor(async () => (await controlEvents(runId)).at(-1) === "user", { label: "user" });
    expect(await hostOf(slot)).toBe("user");
    expect(await userCanHost(slot)).toBe(true);
    // The same input the pending case sent now lands: that check is not vacuous.
    const before = await pointer(slot);
    viewer.socket.send(JSON.stringify({ event: "control/move", payload: { x: 321, y: 123 } }));
    await waitFor(async () => (await pointer(slot)) !== before, { label: "host input lands" });

    // Rapid double-clicks: hand back, take over, hand back, without waiting in between.
    await handBack(agent, runId);
    await takeControl(agent, runId);
    await handBack(agent, runId);
    await waitFor(
      async () =>
        (await controlEvents(runId)).at(-1) === "agent" &&
        (await owner.db.select().from(runs).where(eq(runs.id, runId)))[0]?.controller === "agent",
      { label: "settled on the agent", timeoutMs: 10_000 },
    );
    expect(await hostOf(slot)).toBe("agent");
    expect(await userCanHost(slot)).toBe(false);
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed");

    // Never both: no act started while the user held the n.eko host for this slot.
    const windows: Array<[Date, Date]> = [];
    const mine = marks.filter((m) => m.slot === slot);
    mine.forEach((mark, i) => {
      if (mark.kind !== "give") return;
      const next = mine.slice(i + 1).find((m) => m.kind === "take");
      windows.push([mark.at, next?.at ?? new Date(8.64e15)]);
    });
    expect(windows.length).toBeGreaterThan(0);
    for (const step of (await steps(agent, runId)).filter((s) => s.phase === "act")) {
      for (const [given, taken] of windows) {
        const started = step.createdAt.getTime();
        expect(started > given.getTime() && started < taken.getTime(), `act ${step.seq}`).toBe(
          false,
        );
      }
    }
    closeLiveViews();
  });

  it("a cancel while the user holds control takes the n.eko host back before the slot restarts (Review Focus 5, S12)", async () => {
    const name = scenario("cancel-held", [readInteractive, clickNotes, typeLong, done]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const slot = (await slotOf(agent, runId))!;
    await connectLiveView(slot);
    await takeControl(agent, runId);
    await waitFor(async () => (await controlEvents(runId)).at(-1) === "user", { label: "user" });
    const givenAt = marks.filter((m) => m.slot === slot && m.kind === "give").length;
    await agent.web.db
      .update(runs)
      .set({ status: "cancelled", waitReason: null })
      .where(eq(runs.id, runId));
    await agent.web.sql.notify("run_control", encodeNotify("run_control", { runId }));
    await waitForRun(
      agent,
      runId,
      (run) => run.status === "cancelled" && run.slotName === null,
      "released",
    );
    const after = marks.filter((m) => m.slot === slot).slice(givenAt);
    expect(after.some((m) => m.kind === "take")).toBe(true);
    closeLiveViews();
  });
});
