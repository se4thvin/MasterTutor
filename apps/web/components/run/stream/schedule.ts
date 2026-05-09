/** What scheduleFlush needs from the page (injected in tests). */
interface FlushEnv {
  hidden: boolean;
  raf(callback: () => void): number;
  timeout(callback: () => void, ms: number): unknown;
}

const browserEnv = (): FlushEnv => ({
  hidden: document.hidden,
  raf: (callback) => requestAnimationFrame(callback),
  timeout: (callback, ms) => setTimeout(callback, ms),
});

/** A frame that has not come by then never will (the tab was hidden after scheduling). */
const FRAME_FALLBACK_MS = 100;

/**
 * Applies a batch once per animation frame (A9), but a hidden tab never paints, so there the batch
 * is applied on the next task instead: background tabs still settle the cache (M5). A tab hidden
 * after scheduling also gets a timeout behind the frame; `flush` still runs once per schedule.
 */
export function scheduleFlush(flush: () => void, env: FlushEnv = browserEnv()): void {
  if (env.hidden) {
    env.timeout(flush, 0);
    return;
  }
  // Whichever comes first flushes; the other finds this schedule spent, so a leftover backstop
  // never flushes the next batch early and splits it (final M10).
  let spent = false;
  const once = () => {
    if (spent) return;
    spent = true;
    flush();
  };
  env.raf(once);
  env.timeout(once, FRAME_FALLBACK_MS);
}
