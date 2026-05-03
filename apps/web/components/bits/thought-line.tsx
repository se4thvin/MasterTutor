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
}: {
  label: string;
  working: boolean;
  since: string;
}) {
  const timerRef = useRef<HTMLSpanElement>(null);
  const elapsed = useRef(0);
  const [announce, setAnnounce] = useState(label);

  useEffect(() => {
    const start = Date.parse(since);
    const paint = () => {
      elapsed.current = Math.max(0, Date.now() - start);
      if (timerRef.current) timerRef.current.textContent = formatElapsed(elapsed.current);
    };
    paint();
    if (!working) return undefined;
    const id = setInterval(paint, TICK_MS);
    return () => clearInterval(id);
  }, [since, working]);

  useEffect(() => {
    setAnnounce(working ? label : `Thought for ${spokenElapsed(elapsed.current)}`);
  }, [working, label]);

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
        0.0s
      </span>
      <span className="sr-only" role="status">
        {announce}
      </span>
    </div>
  );
}
