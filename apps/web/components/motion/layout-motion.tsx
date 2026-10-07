"use client";

import { LazyMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Turns on `layout` / `layoutId` for the m.* inside it. The root MotionProvider keeps domAnimation
 * (first-load JS); domMax (~14 kB gz) arrives after first paint through this import() — the only
 * way in (eslint.config.js LAYOUT_FEATURES_STATIC). This nested LazyMotion shadows the root renderer,
 * so until the chunk lands (one cached-chunk microtask after the first load) the m.* inside do not
 * animate at all: no layout glide and no exit fade. A sync fallback would pull domMax into first load.
 */
const loadLayoutFeatures = () =>
  import("./layout-features.ts").then((mod) => {
    // A marker for tests, like data-hotkeys: motion has no load callback. It is document-global:
    // the first <LayoutMotion> to load sets it, and the module is cached for every later one.
    document.documentElement.dataset["layoutMotion"] = "ready";
    return mod.default;
  });

export function LayoutMotion({ children }: { children: ReactNode }) {
  return <LazyMotion features={loadLayoutFeatures}>{children}</LazyMotion>;
}
