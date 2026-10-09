"use client";

import { Suspense, type ComponentType } from "react";
import { lazyComponent } from "@/lib/hooks/lazy-component.ts";
import type { PipProps } from "./pip-types.ts";

/**
 * The one way the app renders Pip: Pip's code stays out of first-load JS and arrives as its own
 * chunk. The box is sized by CSS before the chunk lands, so nothing shifts.
 *
 * MERGE (mascot-3d): the import below becomes `./pip.tsx` (the 3D Pip, which owns its poster,
 * software-GL and reduced-motion fallbacks per the contract). pip-stand-in.tsx then stays only as
 * a test double.
 *
 * Pip is decorative: a chunk that fails to arrive renders nothing, without a toast.
 */
const NoPip = () => null;
const { Component: LazyPip } = lazyComponent((): Promise<ComponentType<PipProps>> =>
  import("./pip-stand-in.tsx").then(
    (mod) => mod.Pip,
    () => NoPip,
  ),
);

export function PipLazy(props: PipProps) {
  return (
    // data-mascot-state is the state machine's output, for tests and the layout; never styling.
    <span className="mascot-slot" data-size={props.size} data-mascot-state={props.state}>
      <Suspense fallback={<span className="mascot-pending" data-mascot-pending="" />}>
        <LazyPip {...props} />
      </Suspense>
    </span>
  );
}
