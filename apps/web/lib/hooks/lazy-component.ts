import { lazy, useEffect, type ComponentType } from "react";
import { whenIdle } from "../when-idle.ts";

/**
 * A component that stays out of first-load JS: `Component` renders it through React.lazy, and
 * `usePrefetch()` fetches its chunk once the browser is idle, so the first open is still instant.
 * Render `Component` inside <Suspense> and a ChunkBoundary.
 *
 * A failed load is final for the page: React.lazy keeps a rejected load (it never calls the
 * loader again), and so does Turbopack's chunk loader. A reload is the only retry, which is what
 * ChunkBoundary offers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any props, like React.lazy
export function lazyComponent<T extends ComponentType<any>>(load: () => Promise<T>) {
  let chunk: Promise<T> | undefined;
  const fetchChunk = () => (chunk ??= load());
  // A failed prefetch is reported where it matters: when the component renders (ChunkBoundary).
  const prefetch = () => void fetchChunk().catch(() => undefined);
  return {
    Component: lazy(() => fetchChunk().then((component) => ({ default: component }))),
    usePrefetch: () => useEffect(() => whenIdle(prefetch), []),
  };
}
