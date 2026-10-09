import type { StepGuardFactory } from "../guardrails/observer/types.ts";
import { setTimeout as delay } from "node:timers/promises";
import type { RunStatus, WaitReason } from "@mastertutor/contracts";
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import type { Database } from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
import { instrument } from "@mastertutor/telemetry/instrument";
import { ControlGuard } from "../browser/guard.ts";
import { modelErrorLog, type ModelCaller } from "../llm/caller.ts";
import type { Clock } from "../runtime/clock.ts";
import type { RuntimeConfig } from "../runtime/config.ts";
import {
  Interrupted,
  LeaseLost,
  ModelUnavailable,
  RunChanged,
  interruptionOf,
  type InterruptCause,
} from "../runtime/errors.ts";
import { Latch } from "../runtime/latch.ts";
import type { Log } from "../runtime/types.ts";
import { clearRunDownloads } from "../slots/downloads.ts";
import { releaseSlot } from "../slots/leases.ts";
import type { SlotPool } from "../slots/pool.ts";
import { renewLeases, type ClaimedRun } from "./claim.ts";
import type { RunHooks, UserControlResult } from "./hooks.ts";
import type { AttachedBrowser, ConnectBrowser } from "./loop-browser.ts";
import type { RunTitler } from "../llm/run-title.ts";
import { RunLoop, type StepOutcome } from "./run-loop.ts";
import { isTerminal, readRunControl, snapshotOf } from "./run-state.ts";
import { startUrl } from "./start-url.ts";
import { StepStore, type Transition } from "./step-store.ts";
import { waitRetentionMs } from "./turn-context.ts";

/** How long a release waits for the slot's browser to go before it disconnects anyway. */
const CLOSE_WAIT_MS = 2_000;

export interface WorkerDeps {
  db: Database;
  storage: Storage;
  caller: ModelCaller;
  pool: SlotPool;
  hooks: RunHooks;
  clock: Clock;
  config: RuntimeConfig;
  log: Log;
  connect: ConnectBrowser;
  titler?: RunTitler;
  guards?: StepGuardFactory;
}

const CONTINUE: StepOutcome = { kind: "continue" };
const NON_TERMINAL: readonly RunStatus[] = ["queued", "running", "waiting", "sleeping"];
type Next = StepOutcome | "slept";
const CONTROL_RESTORE_FAILED = {
  code: "control_restore_failed",
  message: "The live view could not hand the browser back to the agent, so the run stopped.",
};

/** Holds one run's leases and drives its loop until it ends, sleeps or loses its lease. */
export class RunWorker {
  readonly runId: string;
  readonly workspaceId: string;
  readonly #deps: WorkerDeps;
  readonly #claim: ClaimedRun;
  readonly #guard = new ControlGuard();
  readonly #latch = new Latch();
  #abort = new AbortController();
  #stop: InterruptCause | null = null;
  #attached: AttachedBrowser | null = null;
  #store: StepStore | null = null;
  #loop: RunLoop | null = null;
  #started = false;
  #released = false;
  #deadlineTimer: NodeJS.Timeout | undefined;
  /** Settles when the main loop has ended, whether stop() came before or after start() (M1). */
  readonly #finished = Promise.withResolvers<void>();

  constructor(deps: WorkerDeps, claim: ClaimedRun) {
    this.#deps = deps;
    this.#claim = claim;
    this.runId = claim.run.id;
    this.workspaceId = claim.run.workspaceId;
    // The claim just set the lease: until the first renewal the local deadline counts from now.
    this.#fence(performance.now() + deps.config.leaseMs - deps.config.heartbeatMs);
  }

  /** Moves the local lease deadline; when it passes unrenewed, in-flight work is aborted at once. */
  #fence(notAfter: number): void {
    this.#guard.fence(notAfter);
    clearTimeout(this.#deadlineTimer);
    this.#deadlineTimer = setTimeout(
      () => {
        if (this.#guard.expired) this.#loseLease();
      },
      Math.max(0, notAfter - performance.now()) + 1,
    );
    this.#deadlineTimer.unref();
  }

  start(): Promise<void> {
    if (!this.#started) {
      this.#started = true;
      void this.#main().finally(() => this.#finished.resolve());
    }
    return this.#finished.promise;
  }

  notify(): void {
    this.#latch.open();
  }

  /**
   * run_control: takeover, hand back, cancel or Send now. Aborts the in-flight action at once
   * (target ≤ 300 ms); Send now aborts only a model call in flight, and otherwise stops the batch
   * before its next action (RunLoop.takeInterrupt).
   */
  control(): void {
    void readRunControl(this.#deps.db, this.runId)
      .then(async (run) => {
        if (!run) return;
        if (isTerminal(run.status)) this.#abort.abort(new Interrupted("cancel"));
        else if (run.controller === "user" && !this.#guard.held) {
          this.#guard.hold();
          this.#abort.abort(new Interrupted("takeover"));
        } else if (run.controller === "agent" && this.#loop) {
          if ((await this.#loop.takeInterrupt()) === "abort")
            this.#abort.abort(new Interrupted("message"));
        }
      })
      .catch(() =>
        this.#deps.log.warn({ runId: this.runId, errorCode: "control_read_failed" }, "control"),
      )
      // Whatever happened, the worker re-reads the run itself.
      .finally(() => this.#latch.open());
  }

  /** The run was claimed again (its lease lapsed): stop without writing anything. */
  abandon(): Promise<void> {
    this.#loseLease();
    return this.#finished.promise;
  }

  /** Resolves when the main loop has ended (the caller still starts a worker it has not started). */
  stop(why: "kill" | "shutdown"): Promise<void> {
    this.#stop = why;
    this.#abort.abort(new Interrupted(why));
    this.#latch.open();
    return this.#finished.promise;
  }

  #loseLease(): void {
    this.#loop?.stopGuard();
    this.#stop = "lease_lost";
    this.#abort.abort(new Interrupted("lease_lost"));
    this.#latch.open();
  }

  async #main(): Promise<void> {
    const { config, log } = this.#deps;
    const beat = setInterval(() => void this.#beat(), config.heartbeatMs);
    try {
      this.#store = await StepStore.open({
        db: this.#deps.db,
        storage: this.#deps.storage,
        sessionStore: this.#deps.hooks.sessionStore,
        owner: this.#claim.leaseToken,
        run: this.#claim.run,
      });
      // Stopped before it began (e.g. shutdown while waiting on a predecessor): no browser work.
      if (this.#stop) return await this.#onStop();
      this.#attached = await this.#deps.connect({
        slotName: this.#claim.slotName,
        run: () => this.#loop?.run ?? snapshotOf(this.#claim.run),
        guard: this.#guard,
      });
      await this.#deps.hooks.onLeased({
        runId: this.runId,
        workspaceId: this.workspaceId,
        slotName: this.#claim.slotName,
        session: this.#attached!.session,
        browserCdp: () => this.#attached!.browserCdp(),
      });
      let next: Next = await this.#guarded(() => this.#restore());
      for (;;) {
        if (this.#stop) return await this.#onStop();
        if (next === "slept") return;
        if (next.kind === "continue") next = await this.#guarded(() => this.#stepOnce());
        else if (next.kind === "waiting") next = await this.#guarded(() => this.#waitForChange());
        else return await this.#end(next);
      }
    } catch (error) {
      if (this.#stop === "lease_lost" || error instanceof LeaseLost) return;
      if (this.#stop) return await this.#onStop().catch(() => undefined);
      // A model outage keeps its own code (M2); anything else is an unexpected agent error.
      const failure =
        error instanceof ModelUnavailable
          ? { code: error.code, message: error.message }
          : { code: "agent_error", message: "The agent hit an unexpected error." };
      log.error(
        {
          runId: this.runId,
          errorCode: failure.code,
          err: error instanceof Error ? error.name : "unknown",
          // Why OpenAI refused, with this run's vault secrets redacted from its message.
          ...(error instanceof ModelUnavailable
            ? modelErrorLog(error.cause, (text) =>
                this.#deps.hooks.maskSources(this.runId).redact(text),
              )
            : {}),
        },
        "run failed",
      );
      await this.#end({ kind: "failed", error: failure }).catch(() => undefined);
    } finally {
      clearInterval(beat);
      clearTimeout(this.#deadlineTimer);
      if (this.#attached && !this.#released)
        await this.#deps.hooks
          .onLeaseEnding({ runId: this.runId, slotName: this.#claim.slotName, slotReleased: false })
          .catch(() => undefined);
      await this.#attached?.close().catch(() => undefined);
      // Every way a worker ends passes here, exactly once (F11).
      await this.#deps.hooks.onReleased(this.runId).catch(() => undefined);
    }
  }

  async #guarded(work: () => Promise<Next>): Promise<Next> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof RunChanged) return CONTINUE;
      const cause = interruptionOf(error);
      if (cause === null && !this.#abort.signal.aborted) throw error;
      // The local lease deadline passed (ControlGuard): stop as if the lease were lost (I2).
      if (cause === "lease_lost") this.#loseLease();
      if (this.#stop) return CONTINUE;
      const run = await readRunControl(this.#deps.db, this.runId);
      if (!run || isTerminal(run.status)) return { kind: "cancelled" };
      if (run.controller === "user") return this.#holdForUser();
      this.#abort = new AbortController();
      this.#loop?.reobserve();
      return CONTINUE;
    }
  }

  async #restore(): Promise<StepOutcome> {
    const run = this.#claim.run;
    const browser = this.#attached!.browser;
    // The loop exists before any browser work, so a takeover or interruption while the page is
    // being restored is handled like any other (I1).
    this.#loop ??= await RunLoop.restore(
      {
        db: this.#deps.db,
        storage: this.#deps.storage,
        caller: this.#deps.caller,
        browser,
        store: this.#store!,
        hooks: this.#deps.hooks,
        clock: this.#deps.clock,
        config: this.#deps.config,
        log: this.#deps.log,
        leaseExpired: () => this.#guard.expired,
        titler: this.#deps.titler,
        guards: this.#deps.guards,
      },
      snapshotOf(run),
    );
    const state = await this.#deps.hooks.sessionStore.load(run);
    const removeRestore = state ? await browser.applyStorage(state) : null;
    const target = run.currentUrl ?? startUrl(run.goal, run.allowedOrigins);
    try {
      await browser.navigate(target, this.#abort.signal);
    } finally {
      // Even when the navigation is interrupted: a stale restore script must never outlive it (I3).
      await removeRestore?.().catch(() => undefined);
    }
    await browser.restoreView({ scroll: run.scroll ?? null, videoTime: run.videoTime ?? null });
    if (run.controller === "user") return this.#holdForUser(true);
    if (this.#loop.hasPendingApproval) return this.#loop.resume(this.#abort.signal);
    if (run.status === "waiting")
      return { kind: "waiting", reason: (run.waitReason ?? "takeover") as WaitReason };
    return CONTINUE;
  }

  async #stepOnce(): Promise<StepOutcome> {
    const run = await readRunControl(this.#deps.db, this.runId);
    if (!run || isTerminal(run.status)) return { kind: "cancelled" };
    if (run.controller === "user") return this.#holdForUser();
    // A person may change the mode mid-run (run-mode): it governs this step's decisions.
    this.#loop!.useRunControl(run);
    return this.#loop!.step(this.#abort.signal);
  }

  /**
   * A wait ends only on a durable change a person made (spec §5.1, I1): a decided approval, a new
   * message, or a status/controller change. A stale wake keeps waiting; the idle timer sleeps.
   */
  async #waitForChange(): Promise<Next> {
    const timer = new AbortController();
    try {
      const entry = await readRunControl(this.#deps.db, this.runId);
      const idle = this.#deps.clock
        .sleep(
          waitRetentionMs(entry?.waitReason ?? null, this.#deps.config.idleSleepMs),
          timer.signal,
        )
        .then(
          () => false,
          () => false,
        );
      let woke = false;
      for (;;) {
        woke = await Promise.race([this.#latch.wait().then(() => true), idle]);
        if (this.#stop) return CONTINUE;
        const run = await readRunControl(this.#deps.db, this.runId);
        if (!run || isTerminal(run.status)) return { kind: "cancelled" };
        if (run.controller === "user") return this.#holdForUser();
        if (!woke) break;
        const changed = run.status !== entry?.status || run.waitReason !== entry?.waitReason;
        if (changed || (await this.#loop!.hasNews(run.waitReason)))
          return this.#loop!.resume(this.#abort.signal);
      }
      await this.#release({
        transition: {
          from: ["running", "waiting"],
          to: "sleeping",
          waitReason: null,
          reason: null,
        },
      });
      return "slept";
    } finally {
      timer.abort();
    }
  }

  /** While the user holds control: no input, no screenshots, no model calls, no sleep (spec §5.1, §10.3). */
  async #holdForUser(afterRestore = false): Promise<StepOutcome> {
    const slot = this.#claim.slotName;
    this.#guard.hold();
    if (!this.#abort.signal.aborted) this.#abort.abort(new Interrupted("takeover"));
    // Seam 8: handing the browser to the person (spec §7.3).
    const given = await instrument(
      SPAN.takeover,
      { [ATTR.runId]: this.runId, [ATTR.slotName]: slot, [ATTR.controlHolder]: "user" },
      async (span) => {
        const result = await this.#deps.hooks.control
          .onUserControl(slot, this.runId, { afterRestore })
          .catch((): UserControlResult => ({ ok: false, code: "takeover_failed" }));
        span.set({ [ATTR.takeoverOutcome]: result.ok ? "ok" : result.code });
        if (!result.ok) span.fail(result.code);
        return result;
      },
    );
    if (!given.ok) return this.#revertTakeover();
    await this.#loop!.markTakeover();
    for (;;) {
      await this.#latch.wait();
      if (this.#stop) return CONTINUE;
      const run = await readRunControl(this.#deps.db, this.runId);
      if (!run || isTerminal(run.status)) return { kind: "cancelled" };
      if (run.controller === "agent") {
        // B6 retries n.eko with a bounded backoff; if the host still cannot be taken back, the
        // run ends with the guard held (never both inputs, never a retry loop here).
        // Seam 8: taking the browser back from the person.
        const restored = await instrument(
          SPAN.takeover,
          { [ATTR.runId]: this.runId, [ATTR.slotName]: slot, [ATTR.controlHolder]: "agent" },
          async (span) => {
            try {
              await this.#deps.hooks.control.onAgentControl(slot, this.runId);
              span.set({ [ATTR.takeoverOutcome]: "ok" });
              return true;
            } catch {
              span.set({ [ATTR.takeoverOutcome]: "control_restore_failed" });
              span.fail("control_restore_failed");
              return false;
            }
          },
        );
        if (!restored) {
          this.#deps.log.error(
            { runId: this.runId, errorCode: "control_restore_failed" },
            "could not take the live view back",
          );
          return { kind: "failed", error: CONTROL_RESTORE_FAILED };
        }
        this.#guard.release();
        this.#abort = new AbortController();
        await this.#loop!.markHandBack();
        return CONTINUE;
      }
    }
  }

  /**
   * The user's live view could not take the browser (F3): the agent keeps control and goes on.
   * The give may have moved n.eko's host before it failed, so the host is taken back first, as on
   * hand-back, while the guard still holds. If that fails nothing may act again: the guard stays
   * held and the run ends, so the user and the agent never both hold input.
   */
  async #revertTakeover(): Promise<StepOutcome> {
    this.#deps.log.warn({ runId: this.runId, errorCode: "takeover_failed" }, "takeover reverted");
    try {
      await this.#deps.hooks.control.onAgentControl(this.#claim.slotName, this.runId);
    } catch {
      this.#deps.log.error(
        { runId: this.runId, errorCode: "control_restore_failed" },
        "could not take the live view back",
      );
      return { kind: "failed", error: CONTROL_RESTORE_FAILED };
    }
    await this.#loop!.revertTakeover();
    this.#guard.release();
    this.#abort = new AbortController();
    return this.#loop!.hasPendingApproval ? this.#loop!.resume(this.#abort.signal) : CONTINUE;
  }

  async #onStop(): Promise<void> {
    if (this.#stop === "kill") {
      await this.#release({
        transition: {
          from: NON_TERMINAL,
          to: "cancelled",
          waitReason: null,
          reason: "kill switch",
          error: { code: "kill_switch", message: "Stopped by the kill switch" },
        },
      });
    } else if (this.#stop === "shutdown") {
      const run = await readRunControl(this.#deps.db, this.runId);
      if (run && !isTerminal(run.status)) {
        await this.#release({
          transition: {
            from: ["running", "waiting"],
            to: "sleeping",
            waitReason: null,
            reason: null,
          },
          // A run the user holds must come back holding: handBack alone wakes nothing (I2).
          wake: run.status === "running" || run.controller === "user",
        });
      }
    }
  }

  async #end(outcome: StepOutcome): Promise<void> {
    const transition: Transition | undefined =
      outcome.kind === "failed"
        ? {
            from: NON_TERMINAL,
            to: "failed",
            waitReason: null,
            reason: outcome.error.message,
            error: outcome.error,
          }
        : undefined;
    await this.#release({ transition });
  }

  /**
   * Slot release (spec §5.2 rule 5 + Phase 0 amendment): seal storageState, then in ONE transaction
   * mark the slot restarting AND clear runs.slot_name (runs_slot_name_uq), then recycle the slot and
   * delete /downloads/<runId>, which survives slot restarts.
   */
  async #release(options: { transition?: Transition; wake?: boolean }): Promise<void> {
    const { pool, config, log } = this.#deps;
    const slotName = this.#claim.slotName;
    await this.#loop?.releaseGuard();
    const storage =
      options.transition?.to === "failed"
        ? null
        : await this.#attached?.browser.collectStorage().catch(() => null);
    const release = (transition: Transition | undefined) =>
      this.#store!.commit({
        transition,
        storage: storage ?? null,
        run: { releaseLease: true, ...(options.wake ? { wakeRequested: true } : {}) },
        events: [{ type: "slot", slotName: null }],
        extra: (tx) => releaseSlot(tx, { name: slotName, runId: this.runId }),
      });
    try {
      await release(options.transition);
    } catch (error) {
      // The web already moved the run on (e.g. a cancel racing a kill): free the slot anyway (M7).
      if (!(error instanceof RunChanged) || !options.transition) throw error;
      log.warn({ runId: this.runId, errorCode: "release_transition_skipped" }, "run changed");
      await release(undefined);
    }
    this.#released = true;
    // Before Browser.close (pool.reset): B6 takes n.eko back from the user and detaches downloads.
    await this.#deps.hooks
      .onLeaseEnding({ runId: this.runId, slotName, slotReleased: true })
      .catch(() =>
        log.warn({ runId: this.runId, errorCode: "release_hook_failed" }, "release hook failed"),
      );
    // The browser goes before this connection does (I3): the download deny lives on this
    // connection, so it must outlast the page. pool.reset closes the browser; then disconnect.
    const resetting = pool.reset(slotName);
    const gone = this.#attached?.session?.disconnected;
    if (gone) await Promise.race([gone, delay(CLOSE_WAIT_MS)]);
    await this.#attached?.close().catch(() => undefined);
    void resetting;
    await clearRunDownloads(config.downloadsDir, this.runId).catch(() =>
      log.warn(
        { runId: this.runId, errorCode: "downloads_cleanup_failed" },
        "could not clear downloads",
      ),
    );
  }

  async #beat(): Promise<void> {
    const { leaseMs, heartbeatMs } = this.#deps.config;
    // Past the local deadline nothing may act, whatever the database says or cannot say (I2).
    if (this.#guard.expired) return this.#loseLease();
    const started = performance.now();
    try {
      await renewLeases(this.#deps.db, {
        runId: this.runId,
        slotName: this.#claim.slotName,
        owner: this.#claim.leaseToken,
        leaseMs,
      });
      // Counted from when the renewal was sent, the safe side of the database's own clock.
      if (!this.#guard.expired) this.#fence(started + leaseMs - heartbeatMs);
    } catch (error) {
      if (error instanceof LeaseLost) {
        this.#loseLease();
      } else {
        this.#deps.log.warn(
          { runId: this.runId, errorCode: "heartbeat_failed" },
          "heartbeat failed",
        );
      }
    }
  }
}
