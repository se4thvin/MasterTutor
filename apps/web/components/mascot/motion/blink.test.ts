import { describe, expect, it } from "vitest";
import { BLINK, blinkClosure, createBlinker } from "./blink.ts";
import { seeded } from "./random.ts";

/** Samples a blinker at 60 fps and returns the start time (ms) of every blink. */
function blinkStarts(seed: number, seconds: number) {
  const blinker = createBlinker(seeded(seed), 0);
  const starts: number[] = [];
  let previous = 0;
  let peak = 0;
  for (let t = 0; t <= seconds * 1000; t += 1000 / 60) {
    const closure = blinkClosure(blinker, t);
    expect(closure).toBeGreaterThanOrEqual(0);
    expect(closure).toBeLessThanOrEqual(1);
    if (closure > 0 && previous === 0) starts.push(t);
    peak = Math.max(peak, closure);
    previous = closure;
  }
  return { starts, peak };
}

describe("blink scheduler", () => {
  it("blinks fully, every 2–6 s, with an occasional double blink", () => {
    const { starts, peak } = blinkStarts(7, 180);
    expect(peak).toBe(1);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    const doubles = gaps.filter((gap) => gap < BLINK.minGapMs);
    const singles = gaps.filter((gap) => gap >= BLINK.minGapMs);
    // A double blink's second lid follows the first within half a second.
    for (const gap of doubles) expect(gap).toBeLessThan(500);
    for (const gap of singles) {
      expect(gap).toBeGreaterThanOrEqual(BLINK.minGapMs - 20);
      expect(gap).toBeLessThanOrEqual(BLINK.maxGapMs + 20);
    }
    expect(doubles.length).toBeGreaterThan(0);
    expect(doubles.length).toBeLessThan(singles.length / 2);
    // 180 s at one blink every 2–6 s.
    expect(starts.length).toBeGreaterThan(30);
    expect(starts.length).toBeLessThan(110);
  });

  it("is not periodic: gaps vary", () => {
    const { starts } = blinkStarts(3, 60);
    const gaps = starts.slice(1).map((t, i) => Math.round((t - starts[i]!) / 100));
    expect(new Set(gaps).size).toBeGreaterThan(4);
  });

  it("closes and reopens within the micro duration plus a short hold", () => {
    const blinker = createBlinker(() => 0, 0); // first blink at minGapMs, never double
    expect(blinkClosure(blinker, BLINK.minGapMs - 1)).toBe(0);
    expect(blinkClosure(blinker, BLINK.minGapMs + BLINK.closeMs)).toBe(1);
    const total = BLINK.closeMs + BLINK.holdMs + BLINK.openMs;
    expect(blinkClosure(blinker, BLINK.minGapMs + total + 1)).toBe(0);
  });

  it("survives a long pause (a hidden tab) without a backlog of blinks", () => {
    const blinker = createBlinker(seeded(1), 0);
    blinkClosure(blinker, 0);
    const later = 10 * 60 * 1000;
    // One frame after a 10-minute gap: at most one fresh blink is scheduled, never a burst.
    const { starts } = (() => {
      const out: number[] = [];
      let prev = 0;
      for (let t = later; t < later + 1000; t += 1000 / 60) {
        const c = blinkClosure(blinker, t);
        if (c > 0 && prev === 0) out.push(t);
        prev = c;
      }
      return { starts: out };
    })();
    expect(starts.length).toBeLessThanOrEqual(2);
  });
});
