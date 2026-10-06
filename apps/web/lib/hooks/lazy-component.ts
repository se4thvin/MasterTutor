import { lazy, useEffect, type ComponentType } from "react";

/**
 * A component that stays out of first-load JS: `Component` renders it through React.lazy, and
 * `usePrefetch()` fetches its chunk once the browser is idle, so the first open is still instant.
 * Render `Component` inside <Suspense> and a ChunkBoundary. A failed load is not cached here, so
 * a later attempt asks the bundler again (Turbopack itself keeps a failed chunk; ChunkBoundary
 * offers a reload).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any props, like React.lazy
export function lazyComponent<T extends ComponentType<any>>(load: () => Promise<T>) {
  let chunk: Promise<T> | undefined;
  const fetchChunk = () =>
    (chunk ??= load().catch((error: unknown) => {
      chunk = undefined;
      throw error;
    }));
  return {
    Component: lazy(() => fetchChunk().then((component) => ({ default: component }))),
    usePrefetch: () =>
      useEffect(() => {
        // Safari has no requestIdleCallback; a zero timeout still waits for hydration to finish.
        if ("requestIdleCallback" in window) {
          const id = window.requestIdleCallback(() => void fetchChunk());
          return () => window.cancelIdleCallback(id);
        }
        const timer = setTimeout(() => void fetchChunk(), 0);
        return () => clearTimeout(timer);
      }, []),
  };
}
