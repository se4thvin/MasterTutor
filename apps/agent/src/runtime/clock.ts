import { setTimeout as delay } from "node:timers/promises";

/** Time source for loop waits and backoff. Agent-behaviour tests use instantClock (spec §12). */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

async function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, signal ? { signal } : undefined);
  } catch (error) {
    throw signal?.aborted ? signal.reason : error;
  }
}

export const systemClock: Clock = { now: () => Date.now(), sleep: realSleep };

export function instantClock(start = Date.parse("2026-10-05T00:00:00Z")): Clock {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms, signal) => {
      signal?.throwIfAborted();
      now += ms;
      await realSleep(0, signal);
    },
  };
}
