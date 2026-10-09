"use client";

import { Suspense, type ComponentType } from "react";
import { lazyComponent } from "@/lib/hooks/lazy-component.ts";
import { PipFrame } from "./pip-frame.tsx";
import type { PipProps } from "./pip-types.ts";

/** The state's poster, as Pip shows it before its chunk arrives (or if the chunk never does). */
function PipPoster({ state, size, label = "Pip", onPoke }: PipProps) {
  return <PipFrame state={state} size={size} label={label} onPoke={onPoke} />;
}

/**
 * The one way the app renders Pip: pip.tsx (and, behind its own import(), three) stays out of
 * first-load JS. The poster frame renders until the component arrives, so nothing shifts. Pip is
 * decorative: a chunk that fails to arrive keeps the poster, without a toast.
 */
const { Component: LazyPip } = lazyComponent((): Promise<ComponentType<PipProps>> =>
  import("./pip.tsx").then(
    (mod) => mod.Pip,
    () => PipPoster,
  ),
);

export function PipLazy(props: PipProps) {
  return (
    <Suspense fallback={<PipPoster {...props} />}>
      <LazyPip {...props} />
    </Suspense>
  );
}

export default PipLazy;
