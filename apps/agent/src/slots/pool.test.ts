import { createLogger } from "@mastertutor/contracts/server";
import { installTestTelemetry } from "@mastertutor/telemetry/testing";
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

/** `neverLeased` lists the slots still as seeding left them; every other slot was leased before. */
function fakeStore(neverLeased: readonly string[] = []) {
  const idle: string[] = [];
  const store: SlotStore = {
    markIdle: async (name) => {
      idle.push(name);
      return true;
    },
    reclaimExpired: async () => [],
    listRestarting: async (slots) =>
      slots
        .filter((name) => !idle.includes(name))
        .map((name) => ({ name, neverLeased: neverLeased.includes(name) })),
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

  it("admits a never-leased slot without restarting it: its container holds nothing yet", async () => {
    const slot = fakeSlot("first-boot");
    const { store, idle } = fakeStore(["browser-1"]);
    const pool = new SlotPool({
      store,
      slots: ["browser-1"],
      cdpBaseUrl: async () => "http://x",
      control: slot.control,
      config,
      log,
    });
    await pool.reconcile();
    expect(slot.closes).toHaveLength(0);
    expect(slot.current()).toBe("first-boot");
    expect(idle).toEqual(["browser-1"]);
  });

  it("still closes and replaces a slot left over from a lease (released or reclaimed)", async () => {
    const slot = fakeSlot("crashed-run");
    const { store, idle } = fakeStore([]);
    const pool = new SlotPool({
      store,
      slots: ["browser-1"],
      cdpBaseUrl: async () => "http://x",
      control: slot.control,
      config,
      log,
    });
    await pool.reconcile();
    expect(slot.closes).toHaveLength(1);
    expect(slot.current()).toBe("fresh-1");
    expect(idle).toEqual(["browser-1"]);
  });

  it("waits for a never-leased slot's browser to answer before marking it idle", async () => {
    let id: string | null = null;
    const control: BrowserControl = {
      readBrowserId: async () => id,
      closeBrowser: async () => {
        throw new Error("a never-leased slot must not be closed");
      },
    };
    setTimeout(() => {
      id = "late";
    }, 30);
    const { store, idle } = fakeStore(["browser-1"]);
    const pool = new SlotPool({
      store,
      slots: ["browser-1"],
      cdpBaseUrl: async () => "http://x",
      control,
      config,
      log,
    });
    const started = Date.now();
    await pool.reconcile();
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect(idle).toEqual(["browser-1"]);
  });
});

describe("slot reset telemetry (seam 7)", () => {
  it("records ok when the slot comes back and timeout when it does not", async () => {
    const telemetry = installTestTelemetry();
    const healthy = fakeSlot("old");
    await new SlotPool({
      store: fakeStore().store,
      slots: ["browser-1"],
      cdpBaseUrl: async () => "http://slot",
      control: healthy.control,
      config: runtimeConfig({ slotPollMs: 5, slotRestartTimeoutMs: 200 }),
      log,
    }).reset("browser-1");
    await new SlotPool({
      store: fakeStore().store,
      slots: ["browser-2"],
      cdpBaseUrl: async () => "http://slot",
      control: { readBrowserId: async () => null, closeBrowser: async () => undefined },
      config: runtimeConfig({ slotPollMs: 5, slotRestartTimeoutMs: 30 }),
      log,
    }).reset("browser-2");
    const spans = telemetry.spans().filter((s) => s.name === "mt.slot.reset");
    expect(
      spans.map((s) => [s.attributes["mt.slot.name"], s.attributes["mt.slot.outcome"]]),
    ).toEqual([
      ["browser-1", "ok"],
      ["browser-2", "timeout"],
    ]);
    expect(spans[1]!.attributes["mt.error.code"]).toBe("slot_restart_timeout");
    await telemetry.shutdown();
  });
});
