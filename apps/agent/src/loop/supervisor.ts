import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { NotifyPayload } from "@mastertutor/contracts";
import type { DbHandle } from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
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
  /** Owned by the supervisor: stop() and crash() close it. */
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
        run_control: (payload) => this.#workers.get(payload.runId)?.control(),
      },
      this.#options.log,
    );
    await this.#pool.reconcile();
    this.#sweep = setInterval(() => void this.#sweepOnce(), this.#config.sweepMs);
    this.#kick();
  }

  /** Graceful: running runs sleep with a wake, slot restarts finish, then the DB handle closes. */
  async stop(): Promise<void> {
    await this.#halt("shutdown");
    await this.#pool.drain();
    await this.#options.db.close();
  }

  /** Tests only: dies like a killed process (no releases, no status writes). */
  async crash(): Promise<void> {
    await this.#halt("crash");
    await this.#options.db.close();
  }

  async #halt(why: "shutdown" | "crash"): Promise<void> {
    this.#stopped = true;
    if (this.#sweep) clearInterval(this.#sweep);
    await this.#unlisten?.().catch(() => undefined);
    // A claim already in flight may still spawn a worker; wait for it so that worker is stopped too.
    await this.#claiming;
    await Promise.all([...this.#workers.values()].map((worker) => worker.stop(why)));
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
        owner: this.owner,
        connect: this.#connect,
      },
      claim,
    );
    this.#workers.set(claim.run.id, worker);
    void worker.start().finally(() => {
      this.#workers.delete(claim.run.id);
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
    try {
      await this.#pool.reconcile();
      await this.#onKill();
    } catch {
      this.#options.log.warn({ errorCode: "sweep_failed" }, "sweep failed");
    }
    this.#kick();
  }
}
