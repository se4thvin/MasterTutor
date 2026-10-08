import { describe, expect, it } from "vitest";
import { createLimiter, LimiterFull } from "./limiter.ts";

const live = () => new AbortController().signal;

describe("createLimiter (B5 review I-2: a bounded pool of PDF parses)", () => {
  it("runs at most `concurrency` at once and hands slots over in arrival order", async () => {
    const limiter = createLimiter(2, 4);
    const a = await limiter.acquire(live());
    await limiter.acquire(live());
    let third = false;
    const waiting = limiter.acquire(live()).then((free) => ((third = true), free));
    await Promise.resolve();
    expect([limiter.active, third]).toEqual([2, false]);
    a();
    await waiting;
    expect([limiter.active, third]).toEqual([2, true]);
  });
  it("refuses once the queue is full and lets an aborted waiter leave", async () => {
    const limiter = createLimiter(1, 1);
    await limiter.acquire(live());
    const leaving = new AbortController();
    const queued = limiter.acquire(leaving.signal);
    await expect(limiter.acquire(live())).rejects.toBeInstanceOf(LimiterFull);
    leaving.abort();
    await expect(queued).rejects.toBeDefined();
    const next = limiter.acquire(live());
    expect(limiter.active).toBe(1);
    void next;
  });
});
