import { describe, expect, it } from "vitest";
import { abortable, pause } from "./abortable.ts";
import { instantClock } from "./clock.ts";
import { DEFAULT_RUNTIME_CONFIG, runtimeConfig } from "./config.ts";
import { ControlHeld, Interrupted, interruptionOf } from "./errors.ts";
import { Latch } from "./latch.ts";

describe("runtime config", () => {
  it("uses the bounded compaction budget and accepts overrides", () => {
    expect(DEFAULT_RUNTIME_CONFIG).toMatchObject({
      heartbeatMs: 10_000,
      leaseMs: 30_000,
      sweepMs: 30_000,
      idleSleepMs: 60_000,
      slotPollMs: 500,
      compactionInputTokens: 64_000,
      fallbackAfter5xx: 3,
      downloadsDir: "/downloads",
    });
    expect(runtimeConfig({ leaseMs: 3_000 }).leaseMs).toBe(3_000);
  });
});

describe("instantClock", () => {
  it("advances virtual time without waiting", async () => {
    const clock = instantClock(1_000);
    const started = Date.now();
    await clock.sleep(60_000);
    expect(clock.now()).toBe(61_000);
    expect(Date.now() - started).toBeLessThan(500);
  });
  it("rejects with the abort reason", async () => {
    const controller = new AbortController();
    controller.abort(new Interrupted("takeover"));
    await expect(instantClock().sleep(10, controller.signal)).rejects.toBeInstanceOf(Interrupted);
  });
});

describe("abort helpers", () => {
  it("abortable rejects with the reason as soon as the signal fires", async () => {
    const controller = new AbortController();
    const never = new Promise<string>(() => undefined);
    setTimeout(() => controller.abort(new Interrupted("cancel")), 10);
    await expect(abortable(never, controller.signal)).rejects.toMatchObject({ why: "cancel" });
  });
  it("pause rejects with the reason", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Interrupted("kill")), 5);
    await expect(pause(5_000, controller.signal)).rejects.toMatchObject({ why: "kill" });
  });
  it("classifies interruptions", () => {
    expect(interruptionOf(new ControlHeld())).toBe("takeover");
    expect(interruptionOf(new Interrupted("shutdown"))).toBe("shutdown");
    expect(interruptionOf(new Error("x"))).toBeNull();
  });
});

describe("Latch", () => {
  it("remembers an open before wait and resets after", async () => {
    const latch = new Latch();
    latch.open();
    await latch.wait();
    let woke = false;
    void latch.wait().then(() => (woke = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(woke).toBe(false);
    latch.open();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(woke).toBe(true);
  });
});
