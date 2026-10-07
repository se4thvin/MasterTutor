/**
 * Runs `fn` once the browser is idle and returns a cancel. Safari has no requestIdleCallback; a
 * zero timeout still waits for hydration to finish.
 */
export function whenIdle(fn: () => void, timeoutMs?: number): () => void {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(
      fn,
      timeoutMs === undefined ? undefined : { timeout: timeoutMs },
    );
    return () => window.cancelIdleCallback(id);
  }
  const timer = setTimeout(fn, 0);
  return () => clearTimeout(timer);
}
