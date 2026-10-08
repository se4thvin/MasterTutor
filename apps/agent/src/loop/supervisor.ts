import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { NotifyPayload } from "@mastertutor/contracts";
import type { DbHandle } from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
import { sweepObjectDeletions } from "../notes/object-sweep.ts";
import { listenForAgentNotifications } from "../events/listen.ts";
import { ModelCaller } from "../llm/caller.ts";
import type { ModelClient } from "../llm/client.ts";
import { systemClock, type Clock } from "../runtime/clock.ts";
import { runtimeConfig, type RuntimeConfig } from "../runtime/config.ts";
import type { Log } from "../runtime/types.ts";
import type { BrowserControl } from "../slots/lifecycle.ts";
import { SlotPool, createSlotStore } from "../slots/pool.ts";
import { cancelRunsForKill, claimNextRun, killedWorkspaces, type ClaimedRun } from "./claim.ts";
import { withHooks, type RunHooks } from "./hooks.ts";
import type { ConnectBrowser } from "./loop-browser.ts";
import { slotBrowserConnector } from "./session-browser.ts";
import { RunWorker } from "./worker.ts";

export interface SupervisorOptions {
  /** Owned by the supervisor: stop() closes it. */
  db: DbHandle;
  storage: Storage;
  model: ModelClient;
  slots: readonly string[];
  cdpBaseUrl(name: string): Promise<string>;
  log: Log;
  testMode: boolean;
  hooks?: Partial<RunHooks>;
  clock?: Clock;
  config?: Partial<RuntimeConfig>;
  owner?: string;
  connect?: ConnectBrowser;
  browserControl?: BrowserControl;
}

/** LISTENs, sweeps, claims and runs one RunWorker per claimed run (spec §5.2). */
export class Supervisor {
  readonly owner: string;
  readonly #options: SupervisorOptions;
  readonly #config: RuntimeConfig;
  readonly #hooks: RunHooks;
  readonly #clock: Clock;
  readonly #pool: SlotPool;
  readonly #caller: ModelCaller;
  readonly #connect: ConnectBrowser;
  readonly #workers = new Map<string, RunWorker>();
  #claiming: Promise<void> | null = null;
  #claimAgain = false;
  #stopped = false;
  #sweep: NodeJS.Timeout | null = null;
  #sweeping: Promise<void> | null = null;
  #unlisten: (() => Promise<void>) | null = null;

  constructor(options: SupervisorOptions) {
    this.#options = options;
    this.owner = options.owner ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.#config = runtimeConfig(options.config);
    this.#hooks = withHooks(options.hooks);
    this.#clock = options.clock ?? systemClock;
    this.#pool = new SlotPool({
      store: createSlotStore(options.db.db),
      slots: options.slots,
      cdpBaseUrl: options.cdpBaseUrl,
      control: options.browserControl,
      config: this.#config,
      log: options.log,
      onIdle: () => this.#kick(),
    });
    this.#caller = new ModelCaller(options.model, {
      clock: this.#clock,
      fallbackAfter5xx: this.#config.fallbackAfter5xx,
    });
    this.#connect =
      options.connect ??
      slotBrowserConnector({
        cdpBaseUrl: options.cdpBaseUrl,
        pool: this.#pool,
        hooks: this.#hooks,
        clock: this.#clock,
        config: this.#config,
        testMode: options.testMode,
        log: options.log,
      });
  }

  get activeRuns(): string[] {
    return [...this.#workers.keys()];
  }

  async start(): Promise<void> {
    this.#unlisten = await listenForAgentNotifications(
      this.#options.db.sql,
      {
        run_queued: () => this.#kick(),
        run_wake: (payload) => this.#onWake(payload),
        // A code typed into CodeSlots (spec §9): the same wake path as run_wake{reason:"otp"}.
        otp_ready: (payload) => this.#onWake({ runId: payload.runId, reason: "otp" }),
        run_control: (payload) => this.#workers.get(payload.runId)?.control(),
      },
      this.#options.log,
    );
    await this.#pool.reconcile();
    this.#sweep = setInterval(() => {
      // One sweep at a time; a sweep never waits on slot restarts, so it stays short.
      this.#sweeping ??= this.#sweepOnce().finally(() => {
        this.#sweeping = null;
      });
    }, this.#config.sweepMs);
    this.#kick();
  }

  /**
   * Graceful: running runs (and runs the user holds) sleep with a wake, slot restarts get up to
   * `shutdownDrainMs` (boot reconcile recovers the rest), then the DB handle closes.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#sweep) clearInterval(this.#sweep);
    await this.#unlisten?.().catch(() => undefined);
    // A claim already in flight may still spawn a worker; wait for it so that worker is stopped too.
    await this.#claiming;
    await Promise.all([...this.#workers.values()].map((worker) => worker.stop("shutdown")));
    const drained = new AbortController();
    await Promise.race([
      this.#pool.drain(),
      delay(this.#config.shutdownDrainMs, undefined, { signal: drained.signal }).catch(
        () => undefined,
      ),
    ]);
    drained.abort();
    await this.#sweeping;
    await this.#options.db.close();
  }

  #onWake(payload: NotifyPayload<"run_wake">): void {
    if (payload.reason === "kill") {
      void this.#onKill();
      return;
    }
    const worker = payload.runId ? this.#workers.get(payload.runId) : undefined;
    if (worker) worker.notify();
    else this.#kick();
  }

  #kick(): void {
    if (this.#stopped) return;
    if (this.#claiming) {
      this.#claimAgain = true;
      return;
    }
    this.#claiming = this.#claimLoop().finally(() => {
      this.#claiming = null;
    });
  }

  async #claimLoop(): Promise<void> {
    do {
      this.#claimAgain = false;
      for (;;) {
        if (this.#stopped) return;
        const claim = await claimNextRun(this.#options.db.db, {
          owner: this.owner,
          slots: this.#options.slots,
          leaseMs: this.#config.leaseMs,
        }).catch((error: unknown) => {
          this.#options.log.warn(
            { errorCode: "claim_failed", err: error instanceof Error ? error.name : "unknown" },
            "claim failed",
          );
          return null;
        });
        if (!claim) break;
        this.#spawn(claim);
      }
    } while (this.#claimAgain && !this.#stopped);
  }

  #spawn(claim: ClaimedRun): void {
    const worker = new RunWorker(
      {
        db: this.#options.db.db,
        storage: this.#options.storage,
        caller: this.#caller,
        pool: this.#pool,
        hooks: this.#hooks,
        clock: this.#clock,
        config: this.#config,
        log: this.#options.log,
        connect: this.#connect,
      },
      claim,
    );
    const id = claim.run.id;
    // The run's previous slot may still hold a stale worker's browser: restart it now (I2).
    if (claim.reclaimedSlot) void this.#pool.reset(claim.reclaimedSlot).catch(() => undefined);
    // Our own run claimed again (its lease lapsed, e.g. a heartbeat outage): the old worker has
    // lost its lease token, so it is abandoned before the new one starts.
    const previous = this.#workers.get(id);
    this.#workers.set(id, worker);
    void (previous?.abandon() ?? Promise.resolve())
      .then(() => worker.start())
      .finally(() => {
        if (this.#workers.get(id) === worker) this.#workers.delete(id);
        this.#kick();
      });
  }

  async #onKill(): Promise<void> {
    try {
      const killed = await killedWorkspaces(this.#options.db.db);
      if (killed.length === 0) return;
      await Promise.all(
        [...this.#workers.values()]
          .filter((worker) => killed.includes(worker.workspaceId))
          .map((worker) => worker.stop("kill")),
      );
      await cancelRunsForKill(this.#options.db.db, killed);
    } catch {
      this.#options.log.warn({ errorCode: "kill_failed" }, "kill switch handling failed");
    }
  }

  async #sweepOnce(): Promise<void> {
    // The kill fallback (a missed NOTIFY) first: it must not wait behind slot work.
    await this.#onKill();
    // Likewise for run_control: a takeover or cancel whose NOTIFY was lost (M3).
    for (const worker of this.#workers.values()) worker.control();
    try {
      await this.#pool.reconcile({ awaitResets: false });
    } catch {
      this.#options.log.warn({ errorCode: "sweep_failed" }, "sweep failed");
    }
    // A deleted note's objects (web cannot delete objects): retried until each one is gone.
    await sweepObjectDeletions(this.#options.db.db, this.#options.storage, this.#options.log).catch(
      () => this.#options.log.warn({ errorCode: "object_sweep_failed" }, "object sweep failed"),
    );
    this.#kick();
  }
}
