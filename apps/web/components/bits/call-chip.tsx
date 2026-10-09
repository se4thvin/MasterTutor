"use client";
/*
 * Adapted from React Bits "CallChip" (TS-TW).
 * Source:  https://reactbits.dev/r/CallChip-TS-TW.json
 * sha256:  5a1f432a5a687770be8de434b8f705d55904a9bb25a8584341cddc6ead062e2c (fetched 2026-10-08)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: the run thread's action card. The fill wipes on transform (translateX) while the
 * step runs and holds at 90%, then completes and fades its wash on opacity (the clip-path reveal
 * is gone); the rolling glyph swap with its blur becomes a fixed tool glyph (our Icon) with a
 * StatusMark badge, so a finished card still says what it did; the per-frame millisecond timer,
 * the retry button and hugeicons are removed; a cancelled or failed step shakes once (WAAPI,
 * transform only, skipped under reduced motion); sizes, colours and timing come from tokens
 * (run.css .cchip, motion.css); props stripped to glyph, status and content.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { durations, easings } from "@/lib/motion-tokens.ts";
import type { StatusMarkStatus } from "@/lib/status.ts";
import type { IconName } from "@/lib/ui/vocabulary.ts";
import { StatusMark } from "./status-mark.tsx";

const SHAKE = [0, -1, 1, -0.66, 0.66, -0.33, 0];
const SHAKE_PX = 4;
const ENDED: ReadonlySet<StatusMarkStatus> = new Set(["cancelled", "failed"]);

export function CallChip({
  glyph,
  status,
  children,
}: {
  glyph: IconName;
  status: StatusMarkStatus;
  /** The card's words (verb, line, chips); plain text from the caller. */
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const was = useRef(status);
  useEffect(() => {
    const before = was.current;
    was.current = status;
    // Only a step seen running that then stops short shakes: never on mount or on a replay.
    if (before !== "running" || !ENDED.has(status) || !ref.current) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const shake = ref.current.animate(
      SHAKE.map((k) => ({ transform: `translateX(${k * SHAKE_PX}px)` })),
      { duration: durations.shake, easing: `cubic-bezier(${easings.standard.join(",")})` },
    );
    return () => shake.cancel();
  }, [status]);
  return (
    <span ref={ref} className="cchip" data-status={status}>
      <span className="cchip-fill" aria-hidden="true" />
      <span className="cchip-glyph">
        <Icon name={glyph} size="sm" />
        <StatusMark status={status} />
      </span>
      <span className="cchip-text">{children}</span>
    </span>
  );
}
