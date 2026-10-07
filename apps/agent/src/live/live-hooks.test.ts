import { createLogger } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { waitFor } from "../testing/wait.ts";
import type { DownloadIngestor } from "./downloads.ts";
import { createLiveHooks, type LiveControlStore, type PasskeyEnrolmentPort } from "./live-hooks.ts";
import type { LiveView } from "./live-view.ts";
import { LiveViewError } from "./neko-live-view.ts";

const log = createLogger({ service: "test", level: "silent" });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SLOT = "browser-1";
const RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function harness(
  options: {
    /** How many giveControl calls fail with "not connected" first (Infinity: never connects). */
    notConnectedFor?: number;
    /** "flaky": the first two takes fail, then n.eko answers. */
    take?: "ok" | "fails" | "hangs" | "flaky";
    /** Downloads: attach hangs or fails; denying again on hand-back fails. */
    downloads?: "attach-hangs" | "attach-fails" | "off-fails" | "detach-hangs";
    controlUser?: string | null;
    restoreWaitMs?: number;
    /** Wire a fake B3 passkey enrolment; "begin-fails" makes begin reject. */
    enrolment?: "ok" | "begin-fails";
  } = {},
) {
  const calls: string[] = [];
  let failures = options.notConnectedFor ?? 0;
  let idleMs = 0;
  let takes = 0;
  const liveView: LiveView = {
    async giveControl(slot, userId) {
      calls.push(`give ${slot.name} ${userId}`);
      if (failures > 0) {
        failures -= 1;
        throw new LiveViewError("user_not_connected");
      }
    },
    async takeControl(slot) {
      calls.push(`take ${slot.name}`);
      takes += 1;
      if (options.take === "hangs") await new Promise(() => undefined);
      if (options.take === "fails" || (options.take === "flaky" && takes <= 2))
        throw new Error("n.eko down");
    },
    async setClipboardAccess(_slot, on) {
      calls.push(`clipboard ${on}`);
    },
  };
  const store: LiveControlStore = {
    controlUser: async () => (options.controlUser === undefined ? "user_1" : options.controlUser),
    handBackIdle: async (runId) => void calls.push(`idle hand-back ${runId}`),
  };
  const downloads: DownloadIngestor = {
    async attach(slot) {
      calls.push(`attach ${slot.runId}`);
      if (options.downloads === "attach-hangs") await new Promise(() => undefined);
      if (options.downloads === "attach-fails") throw new Error("CDP gone");
    },
    async userControl(_runId, on) {
      calls.push(`downloads ${on ? "on" : "off"}`);
      if (!on && options.downloads === "off-fails") throw new Error("CDP gone");
    },
    async detach(runId) {
      calls.push(`detach ${runId}`);
      if (options.downloads === "detach-hangs") await new Promise(() => undefined);
    },
  };
  const enrolment: PasskeyEnrolmentPort = {
    async begin(session) {
      calls.push(`enrol begin ${session === SESSION}`);
      if (options.enrolment === "begin-fails") throw new Error("CDP gone");
      return "handle-1";
    },
    async finish(handle, run) {
      calls.push(`enrol finish ${String(handle)} ${run.workspaceId} ${run.runId}`);
      return 1;
    },
  };
  const hooks = createLiveHooks({
    store,
    liveView,
    idleProbe: { userIdleMs: async () => idleMs },
    downloads,
    log,
    ...(options.enrolment ? { enrolment } : {}),
    idleLimitMs: 50,
    idlePollMs: 10,
    restoreWaitMs: options.restoreWaitMs ?? 2_000,
    nekoTimeoutMs: 100,
  });
  return { hooks, calls, takes: () => takes, userGoesIdle: () => (idleMs = 99_000_000) };
}

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
/** Enrolment only passes the session through to B3; identity is all the test checks. */
const SESSION = {} as BrowserSession;
const leased = {
  runId: RUN,
  workspaceId: WORKSPACE,
  slotName: SLOT,
  session: SESSION,
  browserCdp: () => Promise.reject(new Error("unused")),
};

describe("createLiveHooks: the n.eko side of B1's control lock", () => {
  it("gives control to a connected live view, turns the clipboard on, then arms the idle hand-back", async () => {
    const { hooks, calls, userGoesIdle } = harness();
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
    expect(calls).toEqual([`give ${SLOT} user_1`, "clipboard true", "downloads on"]);
    userGoesIdle();
    await waitFor(() => calls.includes(`idle hand-back ${RUN}`), { label: "idle hand-back" });
  });

  it("fails the takeover and seats the agent again when no live view is connected (Review Focus 1)", async () => {
    const { hooks, calls, userGoesIdle } = harness({ notConnectedFor: Infinity });
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: false,
      code: "takeover_failed",
    });
    // No take here: B1's revert calls onAgentControl, which takes the host back fail-closed.
    expect(calls).toEqual([`give ${SLOT} user_1`]);
    userGoesIdle();
    await pause(100);
    expect(calls).not.toContain(`idle hand-back ${RUN}`);
  });

  it("keeps trying for the live view when the takeover arrives with a fresh lease", async () => {
    const { hooks, calls } = harness({ notConnectedFor: 3 });
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: true })).toEqual({
      ok: true,
    });
    expect(calls.filter((c) => c.startsWith("give"))).toHaveLength(4);
  });

  it("gives up after the restore wait", async () => {
    const { hooks } = harness({ notConnectedFor: Infinity, restoreWaitMs: 50 });
    const started = performance.now();
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: true })).toEqual({
      ok: false,
      code: "takeover_failed",
    });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("leaves n.eko alone when control was already handed back", async () => {
    const { hooks, calls } = harness({ controlUser: null });
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
    expect(calls).toEqual([]);
  });

  it("hand back disarms the idle watch, takes the host back, then turns the clipboard off", async () => {
    const { hooks, calls, userGoesIdle } = harness();
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.slice(-3)).toEqual([`take ${SLOT}`, "downloads off", "clipboard false"]);
    userGoesIdle();
    await pause(100);
    expect(calls).not.toContain(`idle hand-back ${RUN}`);
  });

  it("hand back fails closed when n.eko cannot take the host back", async () => {
    const { hooks } = harness({ take: "fails" });
    await expect(hooks.control.onAgentControl(SLOT, RUN)).rejects.toThrow("n.eko down");
  });

  it("onLeased seats the agent and attaches downloads, and never fails the lease", async () => {
    const { hooks, calls } = harness({ take: "fails" });
    await hooks.onLeased(leased);
    expect(calls).toEqual(expect.arrayContaining([`take ${SLOT}`, `attach ${RUN}`]));
  });

  it("onLeaseEnding takes the host back within the bound even if n.eko hangs (Review Focus 5, S12)", async () => {
    const { hooks, calls } = harness({ take: "hangs" });
    const started = performance.now();
    await hooks.onLeaseEnding({ runId: RUN, slotName: SLOT, slotReleased: true });
    expect(performance.now() - started).toBeLessThan(1_000);
    // S12: the user's host is revoked first; downloads are settled after.
    expect(calls).toEqual([`take ${SLOT}`, "downloads off", `detach ${RUN}`]);
  });

  it("hand back is idempotent: a second hand back takes the host again and denies downloads again", async () => {
    const { hooks, calls } = harness();
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    await hooks.control.onAgentControl(SLOT, RUN);
    calls.length = 0;
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls).toEqual([`take ${SLOT}`, "downloads off", "clipboard false"]);
  });

  it("hand back retries a failing n.eko with a bounded backoff, never a tight loop", async () => {
    const { hooks, takes } = harness({ take: "flaky" });
    const started = performance.now();
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(takes()).toBe(3);
    // Two pauses (100 ms, then 200 ms) between the three attempts.
    expect(performance.now() - started).toBeGreaterThanOrEqual(290);
  });

  it("hand back gives up after its attempts, within its time bound, even if n.eko hangs", async () => {
    const failing = harness({ take: "fails" });
    await expect(failing.hooks.control.onAgentControl(SLOT, RUN)).rejects.toThrow();
    expect(failing.takes()).toBe(3);
    const hanging = harness({ take: "hangs" });
    const started = performance.now();
    await expect(hanging.hooks.control.onAgentControl(SLOT, RUN)).rejects.toThrow(/timed out/);
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it("hand back fails closed when downloads cannot be denied again (spec §9)", async () => {
    const { hooks, calls } = harness({ downloads: "off-fails" });
    await expect(hooks.control.onAgentControl(SLOT, RUN)).rejects.toThrow("CDP gone");
    expect(calls).not.toContain("clipboard false");
  });

  it("a failed give never offers downloads", async () => {
    const { hooks, calls } = harness({ notConnectedFor: Infinity });
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    expect(calls).not.toContain("downloads on");
  });

  it("onLeased is bounded and survives a download attach that hangs or fails", async () => {
    for (const downloads of ["attach-hangs", "attach-fails"] as const) {
      const { hooks, calls } = harness({ downloads });
      const started = performance.now();
      await hooks.onLeased(leased);
      expect(performance.now() - started, downloads).toBeLessThan(1_000);
      expect(calls).toEqual(expect.arrayContaining([`take ${SLOT}`, `attach ${RUN}`]));
    }
  });

  it("revokes the user's host at lease end even while downloads take long to settle (S12)", async () => {
    const { hooks, calls } = harness({ downloads: "detach-hangs" });
    void hooks.onLeaseEnding({ runId: RUN, slotName: SLOT, slotReleased: true });
    await waitFor(() => calls.includes(`take ${SLOT}`), {
      label: "host taken back",
      timeoutMs: 500,
    });
  });

  it("paces the give retries while the live view reconnects after a fresh lease", async () => {
    const { hooks, calls } = harness({ notConnectedFor: Infinity, restoreWaitMs: 300 });
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: true });
    // One attempt per RETRY_MS (100 ms) over the 300 ms wait, never a tight loop.
    expect(calls.filter((c) => c.startsWith("give")).length).toBeLessThanOrEqual(5);
  });

  it("an unreleased stop only cleans up and never touches n.eko", async () => {
    const { hooks, calls } = harness();
    await hooks.onLeaseEnding({ runId: RUN, slotName: SLOT, slotReleased: false });
    expect(calls).toEqual(["downloads off", `detach ${RUN}`]);
  });
});

describe("createLiveHooks: B3 passkey enrolment during takeover (B3 E.8 note 1)", () => {
  it("begins enrolment after a successful give and finishes it on hand-back", async () => {
    const { hooks, calls } = harness({ enrolment: "ok" });
    await hooks.onLeased(leased);
    calls.length = 0;
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    expect(calls).toEqual([
      `give ${SLOT} user_1`,
      "clipboard true",
      "downloads on",
      "enrol begin true",
    ]);
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.slice(4)).toEqual([
      `take ${SLOT}`,
      "downloads off",
      `enrol finish handle-1 ${WORKSPACE} ${RUN}`,
      "clipboard false",
    ]);
    // A second hand-back has nothing left to seal.
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.filter((c) => c.startsWith("enrol finish"))).toHaveLength(1);
  });

  it("a failed give never begins enrolment", async () => {
    const { hooks, calls } = harness({ enrolment: "ok", notConnectedFor: Infinity });
    await hooks.onLeased(leased);
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.some((c) => c.startsWith("enrol"))).toBe(false);
  });

  it("a failing begin never fails the takeover, and leaves nothing to finish", async () => {
    const { hooks, calls } = harness({ enrolment: "begin-fails" });
    await hooks.onLeased(leased);
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.some((c) => c.startsWith("enrol finish"))).toBe(false);
  });

  it("a lease ending during takeover finishes enrolment, then forgets the lease", async () => {
    const { hooks, calls } = harness({ enrolment: "ok" });
    await hooks.onLeased(leased);
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    await hooks.onLeaseEnding({ runId: RUN, slotName: SLOT, slotReleased: true });
    expect(calls).toContain(`enrol finish handle-1 ${WORKSPACE} ${RUN}`);
    calls.length = 0;
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    expect(calls.some((c) => c.startsWith("enrol"))).toBe(false);
  });

  it("without a session (fake browser) or without the vault, takeover still works", async () => {
    const { hooks, calls } = harness({ enrolment: "ok" });
    await hooks.onLeased({ ...leased, session: null });
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
    expect(calls.some((c) => c.startsWith("enrol"))).toBe(false);
    const plain = harness();
    await plain.hooks.onLeased(leased);
    expect(await plain.hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
  });
});
