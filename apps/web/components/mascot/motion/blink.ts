import { durations } from "@/lib/motion-tokens.ts";
import type { Random } from "./random.ts";

/**
 * Natural blinking: a blink every 2–6 s at random, now and then a double blink. One blink is the
 * micro duration (close fast, open a little slower) with a short hold while the lid is shut.
 */
export const BLINK = {
  minGapMs: 2_000,
  maxGapMs: 6_000,
  doubleChance: 0.18,
  closeMs: durations.micro * 0.4,
  holdMs: 30,
  openMs: durations.micro * 0.6,
  /** From the end of the first blink of a double to the start of the second. */
  doubleGapMs: 110,
} as const;

const BLINK_MS = BLINK.closeMs + BLINK.holdMs + BLINK.openMs;

export interface Blinker {
  rand: Random;
  /** Start times (ms) of the blinks in the current group: one, or two for a double blink. */
  group: number[];
  nextAt: number;
}

const gap = (rand: Random) => BLINK.minGapMs + rand() * (BLINK.maxGapMs - BLINK.minGapMs);

export function createBlinker(rand: Random, now: number): Blinker {
  return { rand, group: [], nextAt: now + gap(rand) };
}

const easeInOut = (t: number) => t * t * (3 - 2 * t);

/** How shut the lid is at `now` for one blink that started at `start`: 0 open … 1 closed. */
function lid(now: number, start: number): number {
  const t = now - start;
  if (t < 0 || t >= BLINK_MS) return 0;
  if (t < BLINK.closeMs) return easeInOut(t / BLINK.closeMs);
  if (t < BLINK.closeMs + BLINK.holdMs) return 1;
  return 1 - easeInOut((t - BLINK.closeMs - BLINK.holdMs) / BLINK.openMs);
}

/** Lid closure (0–1) at `now` (ms, monotonic). Schedules the next blink group as time passes. */
export function blinkClosure(b: Blinker, now: number): number {
  const groupEnd = (b.group.at(-1) ?? -Infinity) + BLINK_MS;
  if (now >= b.nextAt && now >= groupEnd) {
    // After a long pause (hidden tab), start from now: one blink, never a backlog.
    const start = now - b.nextAt > BLINK.maxGapMs ? now : b.nextAt;
    b.group = [start];
    if (b.rand() > 1 - BLINK.doubleChance) b.group.push(start + BLINK_MS + BLINK.doubleGapMs);
    b.nextAt = start + gap(b.rand);
  }
  let closure = 0;
  for (const start of b.group) closure = Math.max(closure, lid(now, start));
  return closure;
}
