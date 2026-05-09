"use client";

import { AnimatePresence, m } from "motion/react";
import { transitions } from "@/lib/motion-tokens.ts";
import type { BrowserState } from "../model/browser-state.ts";

/**
 * One line pinned to the frame; crossfades per step (run 13 §6). The text arrives cleaned.
 * `announce` is off while the timeline's own live line speaks for the run (I1).
 */
export function Caption({
  text,
  step,
  tone,
  announce,
}: {
  text: string;
  step: string | null;
  tone: BrowserState;
  announce: boolean;
}) {
  return (
    <div className="run-caption glass" data-tone={tone}>
      <span className="run-caption-dot" aria-hidden="true" />
      <div className="run-caption-lines" aria-live={announce ? "polite" : "off"}>
        <AnimatePresence initial={false}>
          <m.span
            key={text}
            className="run-caption-line"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: transitions.exit }}
            transition={transitions.base}
          >
            <bdi>{text}</bdi>
          </m.span>
        </AnimatePresence>
      </div>
      {step ? <span className="run-step-no">{step}</span> : null}
    </div>
  );
}
