"use client";
/*
 * Adapted from React Bits "ThoughtLine" (TS-TW).
 * Source:  https://reactbits.dev/r/ThoughtLine-TS-TW.json
 * sha256:  a0499120d803a9da926163c3172f8f1e6a4df8726fa5aac32fa611dc9e9e70d9 (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: the blur crossfade between "thinking" and "thought for" becomes an opacity
 * crossfade; the shimmer and the step trace are removed; the glyph is our Icon (agentNote) and
 * breathes on F1's opacity-only `pulse` keyframes; the elapsed timer writes textContent through a
 * ref every 100ms (no React render per tick); the label is untrusted model text, so it arrives
 * cleaned and renders inside <bdi>; one polite status line speaks the change; timing and colours
 * from tokens (run.css .tline); reduced motion keeps only the fades (motion.css).
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { formatElapsed, spokenElapsed } from "./format.ts";

const TICK_MS = 100;

export function ThoughtLine({
  label,
  working,
  since,
  until = null,
}: {
  label: string;
  working: boolean;
  /** When this spell of thinking began; stable while it lasts. */
  since: string;
  /** When it ended; the frozen timer shows until − since. */
  until?: string | null;
}) {
  const timerRef = useRef<HTMLSpanElement>(null);
  // A finished spell is known from its ends, not from the clock (I2).
  const spent =
    !working && until !== null ? Math.max(0, Date.parse(until) - Date.parse(since)) : null;
  const [announce, setAnnounce] = useState(
    spent === null ? label : `Thought for ${spokenElapsed(spent)}`,
  );

  useEffect(() => {
    if (spent !== null) {
      if (timerRef.current) timerRef.current.textContent = formatElapsed(spent);
      return undefined;
    }
    const start = Date.parse(since);
    const paint = () => {
      if (timerRef.current) {
        timerRef.current.textContent = formatElapsed(Math.max(0, Date.now() - start));
      }
    };
    paint();
    if (!working) return undefined;
    const id = setInterval(paint, TICK_MS);
    return () => clearInterval(id);
  }, [since, working, spent]);

  useEffect(() => {
    setAnnounce(spent === null ? label : `Thought for ${spokenElapsed(spent)}`);
  }, [spent, label]);

  return (
    <div className="tline" data-working={working || undefined}>
      <span className="tline-glyph" aria-hidden="true">
        <Icon name="agentNote" size="sm" />
      </span>
      <span className="tline-labels" aria-hidden="true">
        <bdi className="tline-work">{label}</bdi>
        <span className="tline-done">Thought for</span>
      </span>
      <span ref={timerRef} className="tline-timer" aria-hidden="true">
        {formatElapsed(spent ?? 0)}
      </span>
      <span className="sr-only" role="status">
        {announce}
      </span>
    </div>
  );
}
