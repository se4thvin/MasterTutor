import type { Database } from "@mastertutor/db";
import { setTimeout as delay } from "node:timers/promises";
import type { RuntimeConfig } from "../runtime/config.ts";
import type { Log } from "../runtime/types.ts";
import { listSlotsInState, markSlotIdle, reclaimExpiredSlots } from "./leases.ts";
import { cdpBrowserControl, type BrowserControl } from "./lifecycle.ts";

export interface SlotStore {
  markIdle(name: string): Promise<boolean>;
  reclaimExpired(slots: readonly string[]): Promise<string[]>;
  listRestarting(slots: readonly string[]): Promise<string[]>;
}

export function createSlotStore(db: Database): SlotStore {
  return {
    markIdle: (name) => markSlotIdle(db, name),
    reclaimExpired: (slots) => reclaimExpiredSlots(db, slots),
    listRestarting: (slots) => listSlotsInState(db, slots, "restarting"),
  };
}

export interface SlotPoolOptions {
  store: SlotStore;
  slots: readonly string[];
  /** Resolves a slot to its CDP base URL by IP (Phase 0 slotCdpBaseUrl); tests map to published ports. */
  cdpBaseUrl(name: string): Promise<string>;
  control?: BrowserControl;
  config: RuntimeConfig;
  log: Log;
  /** Called when a slot becomes idle, so the supervisor can try a claim at once. */
  onIdle?(name: string): void;
}

/**
 * Slot recycling (spec §5.2 rule 5). Slots hold no state across leases: every release closes
 * Chromium, the container restarts with an empty profile, and the slot is idle again only once
 * a browser with a new id answers. Polling uses real time because the slot restarts in real time.
 */
export class SlotPool {
  readonly #options: SlotPoolOptions;
  readonly #control: BrowserControl;
  readonly #known = new Map<string, string>();
  readonly #inFlight = new Map<string, Promise<void>>();

  constructor(options: SlotPoolOptions) {
    this.#options = options;
    this.#control = options.control ?? cdpBrowserControl;
  }

  resetting(name: string): boolean {
    return this.#inFlight.has(name);
  }

  /** Records the id of the browser a run attached to, so its replacement can be recognised. */
  async rememberBrowser(name: string, baseUrl: string): Promise<void> {
    const id = await this.#control.readBrowserId(baseUrl);
    if (id) this.#known.set(name, id);
  }

  reset(name: string): Promise<void> {
    const running = this.#inFlight.get(name);
    if (running) return running;
    const work = this.#reset(name).finally(() => this.#inFlight.delete(name));
    this.#inFlight.set(name, work);
    return work;
  }

  /** Waits for every slot restart in flight, so a stopping agent leaves no slot half-recycled. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.#inFlight.values()]);
  }

  /** Boot and sweep: retire expired leases, then bring every restarting slot back. */
  async reconcile(): Promise<void> {
    const reclaimed = await this.#options.store.reclaimExpired(this.#options.slots);
    if (reclaimed.length > 0)
      this.#options.log.warn({ slots: reclaimed }, "reclaimed slots from expired leases");
    const restarting = await this.#options.store.listRestarting(this.#options.slots);
    await Promise.all(
      restarting.filter((name) => !this.resetting(name)).map((name) => this.reset(name)),
    );
  }

  async #baseUrl(name: string): Promise<string | null> {
    try {
      return await this.#options.cdpBaseUrl(name);
    } catch {
      return null;
    }
  }

  async #reset(name: string): Promise<void> {
    const { config, log } = this.#options;
    let previous = this.#known.get(name) ?? null;
    const deadline = Date.now() + config.slotRestartTimeoutMs;
    let closedOnce = false;
    while (Date.now() < deadline) {
      const baseUrl = await this.#baseUrl(name);
      const id = baseUrl ? await this.#control.readBrowserId(baseUrl) : null;
      if (baseUrl && id) {
        if (previous !== null && id !== previous) {
          this.#known.set(name, id);
          if (await this.#options.store.markIdle(name)) this.#options.onIdle?.(name);
          return;
        }
        // Either we never saw this slot's browser (it may hold a previous run's profile) or it is still
        // the old browser: close it once and wait for a replacement with a different id.
        if (!closedOnce) {
          await this.#control.closeBrowser(baseUrl);
          closedOnce = true;
          previous = id;
        }
      }
      await delay(config.slotPollMs);
    }
    log.error(
      { slot: name },
      "slot did not restart in time; it stays restarting until the next sweep",
    );
  }
}
