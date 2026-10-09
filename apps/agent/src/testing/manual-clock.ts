import type { Clock } from "../runtime/clock.ts";

/** Advances wait deadlines without waiting in real time; aborts remove stale sleepers. */
export function manualClock() {
  const base = Date.now();
  let elapsed = 0;
  const sleepers = new Map<() => void, number>();
  const clock: Clock = {
    now: () => base + elapsed,
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        signal?.throwIfAborted();
        sleepers.set(resolve, elapsed + ms);
        signal?.addEventListener(
          "abort",
          () => {
            sleepers.delete(resolve);
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  };
  return {
    clock,
    pending: () => sleepers.size,
    advance(ms: number) {
      elapsed += ms;
      for (const [resolve, deadline] of sleepers) {
        if (deadline > elapsed) continue;
        sleepers.delete(resolve);
        resolve();
      }
    },
  };
}
