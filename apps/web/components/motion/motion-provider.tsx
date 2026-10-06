"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import type { ReactNode } from "react";
import { transitions } from "@/lib/motion-tokens.ts";

/** strict: rendering a full `motion.*` component throws, which keeps the bundle on `m.*`. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={transitions.spring}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
