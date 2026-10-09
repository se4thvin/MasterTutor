"use client";

import { Suspense, lazy } from "react";
import { PipFrame } from "./pip-frame.tsx";
import type { PipProps } from "./pip-types.ts";

const LazyPip = lazy(() => import("./pip.tsx"));

/** Pip behind an import() boundary: the poster frame renders until the component arrives. */
export default function PipLazy(props: PipProps) {
  return (
    <Suspense
      fallback={<PipFrame state={props.state} size={props.size} label={props.label ?? "Pip"} />}
    >
      <LazyPip {...props} />
    </Suspense>
  );
}

export { PipLazy };
