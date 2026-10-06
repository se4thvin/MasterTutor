import { AUTO_HAND_BACK_IDLE_MS, TAKEOVER_RESTORE_WAIT_MS } from "@mastertutor/contracts";
import {
  emitRunEvent,
  notifyRunControl,
  readControlUser,
  returnControlToAgent,
  type Database,
} from "@mastertutor/db";
import type { BrowserSession } from "../browser/session.ts";
import type { RunHooks, UserControlResult } from "../loop/hooks.ts";
import type { Log } from "../runtime/types.ts";
import type { DownloadIngestor } from "./downloads.ts";
import type { SlotIdleProbe } from "./idle-probe.ts";
import { createIdleWatch } from "./idle-watch.ts";
import type { LiveView } from "./live-view.ts";
import { LiveViewError } from "./neko-live-view.ts";

const IDLE_MESSAGE = "Control went back to the agent after 15 minutes without input.";
const FAILED: UserControlResult = { ok: false, code: "takeover_failed" };
const RETRY_MS = 100;
/** Hand-back attempts at n.eko, with a doubling pause between them (100 ms, then 200 ms). */
const HAND_BACK_ATTEMPTS = 3;

/** The two run-row facts the live hooks need; liveControlStore is the database implementation. */
export interface LiveControlStore {
  /** The member holding control, or null once the agent holds it again. */
  controlUser(runId: string): Promise<string | null>;
  /** Idle hand-back: control → agent, a notice for the user, NOTIFY run_control (B1 does the rest). */
  handBackIdle(runId: string): Promise<void>;
}

export function liveControlStore(db: Database): LiveControlStore {
  return {
    controlUser: (runId) => readControlUser(db, runId),
    handBackIdle: (runId) =>
      db.transaction(async (tx) => {
        if (!(await returnControlToAgent(tx, runId))) return;
        await emitRunEvent(tx, runId, {
          type: "error",
          code: "idle_hand_back",
          message: IDLE_MESSAGE,
        });
        await notifyRunControl(tx, runId);
      }),
  };
}

/**
 * B3's passkey enrolment (E.8 note 1), described structurally so the live view never imports the
 * vault: `main.ts` passes `vault.enrolment`. Registrations the user makes during a takeover land
 * in the authenticator begin() installs; finish() seals them and removes it.
 */
export interface PasskeyEnrolmentPort {
  begin(session: BrowserSession): Promise<unknown>;
  finish(handle: unknown, run: { workspaceId: string; runId: string }): Promise<number>;
}

export interface LiveHooksDeps {
  store: LiveControlStore;
  liveView: LiveView;
  idleProbe: SlotIdleProbe;
  downloads: DownloadIngestor;
  log: Log;
  /** Absent in tests that run without the vault. */
  enrolment?: PasskeyEnrolmentPort;
  idleLimitMs?: number;
  idlePollMs?: number;
  /** Patience for a takeover that arrives with a fresh lease (the iframe is still reconnecting). */
  restoreWaitMs?: number;
  /** Bound on the best-effort n.eko calls at lease and release. */
  nekoTimeoutMs?: number;
}

export type LiveHooks = Pick<RunHooks, "control" | "onLeased" | "onLeaseEnding">;

/** Per-lease facts enrolment needs; handle is set while an enrolment is open. */
interface Lease {
  session: BrowserSession | null;
  workspaceId: string;
  handle?: unknown;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** B6's RunHooks: the n.eko side of B1's control lock, plus downloads (spec §10.1–10.3). */
export function createLiveHooks(deps: LiveHooksDeps): LiveHooks {
  const restoreWaitMs = deps.restoreWaitMs ?? TAKEOVER_RESTORE_WAIT_MS;
  const nekoTimeoutMs = deps.nekoTimeoutMs ?? 1_000;
  const idle = createIdleWatch({
    probe: deps.idleProbe,
    limitMs: deps.idleLimitMs ?? AUTO_HAND_BACK_IDLE_MS,
    pollMs: deps.idlePollMs ?? 30_000,
    onIdle: (runId) => deps.store.handBackIdle(runId),
    log: deps.log,
  });
  const leases = new Map<string, Lease>();

  /** Best effort: begin B3's enrolment on the leased page session; a failure never fails the takeover. */
  async function beginEnrolment(runId: string): Promise<void> {
    const lease = leases.get(runId);
    if (!lease?.session || !deps.enrolment) return;
    lease.handle = await deps.enrolment.begin(lease.session).catch((): undefined => {
      deps.log.warn({ runId, errorCode: "enrolment_begin_failed" }, "passkey enrolment");
      return undefined;
    });
  }

  /** Best effort: seal what the user enrolled and close the enrolment (at most once per begin). */
  async function finishEnrolment(runId: string): Promise<void> {
    const lease = leases.get(runId);
    if (lease?.handle === undefined || !deps.enrolment) return;
    const handle = lease.handle;
    lease.handle = undefined;
    await deps.enrolment
      .finish(handle, { workspaceId: lease.workspaceId, runId })
      .catch(() =>
        deps.log.warn({ runId, errorCode: "enrolment_finish_failed" }, "passkey enrolment"),
      );
  }

  /**
   * Best effort within nekoTimeoutMs: the agent's admin session becomes n.eko host and the user
   * loses can_host. Retried, because n.eko may still be starting right after a slot restart.
   */
  async function seatAgent(slotName: string, runId: string, errorCode: string): Promise<void> {
    const deadline = performance.now() + nekoTimeoutMs;
    for (;;) {
      try {
        const left = Math.max(1, deadline - performance.now());
        await withTimeout(deps.liveView.takeControl({ name: slotName }), left);
        return;
      } catch {
        if (performance.now() >= deadline - RETRY_MS) {
          deps.log.warn({ runId, errorCode }, "n.eko host not reset");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }

  /** The user's host and can_host revoked, retried with a doubling pause; throws when out of attempts. */
  async function takeBack(slotName: string, runId: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await withTimeout(deps.liveView.takeControl({ name: slotName }), nekoTimeoutMs);
        return;
      } catch (error) {
        if (attempt >= HAND_BACK_ATTEMPTS) throw error;
        deps.log.warn({ runId, errorCode: "neko_take_retry" }, "n.eko host not taken back yet");
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS * 2 ** (attempt - 1)));
      }
    }
  }

  async function give(
    slotName: string,
    runId: string,
    userId: string,
    patienceMs: number,
  ): Promise<boolean> {
    const deadline = performance.now() + patienceMs;
    for (;;) {
      try {
        await deps.liveView.giveControl({ name: slotName }, userId);
        return true;
      } catch (error) {
        if (!(error instanceof LiveViewError) || performance.now() >= deadline) {
          deps.log.warn(
            { runId, errorCode: error instanceof LiveViewError ? error.code : "neko_give_failed" },
            "takeover not delivered",
          );
          return false;
        }
      }
    }
  }

  return {
    control: {
      async onUserControl(slotName, runId, { afterRestore }) {
        let userId: string | null;
        try {
          userId = await deps.store.controlUser(runId);
        } catch {
          return FAILED;
        }
        // Handed back before n.eko was touched: nothing to give; B1 hands back next.
        if (userId === null) return { ok: true };
        if (!(await give(slotName, runId, userId, afterRestore ? restoreWaitMs : 0))) {
          await seatAgent(slotName, runId, "neko_take_failed");
          return FAILED;
        }
        await deps.liveView
          .setClipboardAccess({ name: slotName }, true)
          .catch(() => deps.log.warn({ runId, errorCode: "clipboard_on_failed" }, "clipboard off"));
        // Taking over is the approval: the member in control may download (A11). Best effort.
        await deps.downloads
          .userControl(runId, true)
          .catch(() => deps.log.warn({ runId, errorCode: "downloads_on_failed" }, "downloads"));
        await beginEnrolment(runId);
        idle.arm(slotName, runId);
        return { ok: true };
      },
      async onAgentControl(slotName, runId) {
        idle.disarm(runId);
        // Must succeed before B1 releases the guard: if n.eko cannot take the host back, the run
        // fails closed rather than let the user and the agent drive at once (spec §10.3).
        // Idempotent (take and revoke again) and bounded: each attempt is time-boxed.
        await takeBack(slotName, runId);
        // Downloads are denied again before the agent acts (spec §9): also fail closed.
        await withTimeout(deps.downloads.userControl(runId, false), nekoTimeoutMs);
        await finishEnrolment(runId);
        await deps.liveView
          .setClipboardAccess({ name: slotName }, false)
          .catch(() => deps.log.warn({ runId, errorCode: "clipboard_off_failed" }, "clipboard"));
      },
    },
    async onLeased(slot) {
      leases.set(slot.runId, { session: slot.session, workspaceId: slot.workspaceId });
      await Promise.all([
        seatAgent(slot.slotName, slot.runId, "neko_seat_failed"),
        // Bounded and never fatal: without downloads the run goes on (the user cannot download).
        withTimeout(deps.downloads.attach(slot), nekoTimeoutMs).catch(() =>
          deps.log.warn({ runId: slot.runId, errorCode: "downloads_attach_failed" }, "downloads"),
        ),
      ]);
    },
    async onLeaseEnding(slot) {
      idle.disarm(slot.runId);
      // A run cancelled during a takeover still seals what the user enrolled (before Browser.close).
      await finishEnrolment(slot.runId);
      leases.delete(slot.runId);
      await deps.downloads.detach(slot.runId).catch(() => undefined);
      // S12: a released run must not leave the user with X input until the container restarts.
      if (slot.slotReleased) await seatAgent(slot.slotName, slot.runId, "neko_release_failed");
    },
  };
}
