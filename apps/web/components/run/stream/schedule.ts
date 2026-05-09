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
 * after scheduling also gets a timeout behind the frame; `flush` must be safe to call twice.
 */
export function scheduleFlush(flush: () => void, env: FlushEnv = browserEnv()): void {
  if (env.hidden) {
    env.timeout(flush, 0);
    return;
  }
  env.raf(flush);
  env.timeout(flush, FRAME_FALLBACK_MS);
}
