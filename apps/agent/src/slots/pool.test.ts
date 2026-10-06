import { createLogger } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import { runtimeConfig } from "../runtime/config.ts";
import type { BrowserControl } from "./lifecycle.ts";
import { SlotPool, type SlotStore } from "./pool.ts";

/** Simulates a slot container: closeBrowser makes the next reads return a new id after a delay. */
function fakeSlot(initialId: string | null) {
  let id = initialId;
  let generation = 0;
  const closes: number[] = [];
  const control: BrowserControl = {
    readBrowserId: async () => id,
    closeBrowser: async () => {
      closes.push(Date.now());
      id = null;
      setTimeout(() => {
        generation += 1;
        id = `fresh-${generation}`;
      }, 20);
    },
  };
  return { control, closes, current: () => id };
}

function fakeStore() {
  const idle: string[] = [];
  const store: SlotStore = {
    markIdle: async (name) => {
      idle.push(name);
      return true;
    },
    reclaimExpired: async () => [],
    listRestarting: async (slots) => slots.filter((name) => !idle.includes(name)),
  };
  return { store, idle };
}

const log = createLogger({ service: "test", level: "silent" });
const config = runtimeConfig({ slotPollMs: 5, slotRestartTimeoutMs: 2_000 });

describe("SlotPool.reset", () => {
  it("closes a browser it never saw, waits for a new id, then marks the slot idle", async () => {
    const slot = fakeSlot("old");
    const { store, idle } = fakeStore();
    const pool = new SlotPool({
      store,
      slots: ["browser-1"],
      cdpBaseUrl: async () => "http://x",
      control: slot.control,
      config,
      log,
    });
    await pool.reset("browser-1");
    expect(slot.closes).toHaveLength(1);
    expect(idle).toEqual(["browser-1"]);
  });

  it("treats a different id from the remembered one as already fresh", async () => {
    const slot = fakeSlot("old");
    const { store, idle } = fakeStore();
    const pool = new SlotPool({
      store,
      slots: ["browser-1"],
      cdpBaseUrl: async () => "http://x",
      control: slot.control,
      config,
      log,
    });
    await pool.rememberBrowser("browser-1", "http://x");
    await slot.control.closeBrowser("http://x");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await pool.reset("browser-1");
    expect(slot.closes).toHaveLength(1);
    expect(idle).toEqual(["browser-1"]);
  });

  it("deduplicates concurrent resets of the same slot", async () => {
    const slot = fakeSlot("old");
    const { store, idle } = fakeStore();
    const pool = new SlotPool({
      store,
      slots: ["browser-1"],
      cdpBaseUrl: async () => "http://x",
      control: slot.control,
      config,
      log,
    });
    await Promise.all([pool.reset("browser-1"), pool.reset("browser-1")]);
    expect(slot.closes).toHaveLength(1);
    expect(idle).toEqual(["browser-1"]);
  });

  it("leaves a slot restarting when it never comes back", async () => {
    const control: BrowserControl = {
      readBrowserId: async () => null,
      closeBrowser: async () => undefined,
    };
    const { store, idle } = fakeStore();
    const pool = new SlotPool({
      store,
      slots: ["browser-1"],
      cdpBaseUrl: async () => "http://x",
      control,
      config: runtimeConfig({ slotPollMs: 5, slotRestartTimeoutMs: 50 }),
      log,
    });
    await pool.reset("browser-1");
    expect(idle).toEqual([]);
  });
});

describe("SlotPool.reconcile", () => {
  it("resets every restarting slot", async () => {
    const slot = fakeSlot("old");
    const { store, idle } = fakeStore();
    const pool = new SlotPool({
      store,
      slots: ["browser-1", "browser-2"],
      cdpBaseUrl: async () => "http://x",
      control: slot.control,
      config,
      log,
    });
    await pool.reconcile();
    expect(idle.sort()).toEqual(["browser-1", "browser-2"]);
  });
});
