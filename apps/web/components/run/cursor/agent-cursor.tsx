"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cubicBezier } from "@/lib/easing.ts";
import { easings } from "@/lib/motion-tokens.ts";
import { arcControl, pointOnArc, travelMs, type Point } from "./cursor-path.ts";

const ease = cubicBezier(easings.cursor);
const HOTSPOT = { x: 3, y: 2 };

interface AgentCursorProps {
  /** Viewport pixels; null hides the cursor. */
  target: Point | null;
  /** A new value plays the click ring once (the seq of a finished click with `pointer`). */
  pulseKey: number | null;
  hidden: boolean;
  thinking: boolean;
}

/** The only agent cursor: CDP input never moves the X cursor (spec §10.2). Event-driven, not per frame. */
/**
 * Whether the click ring plays: once per pointer step. A step whose ring was hidden is not replayed
 * when the cursor shows again (`suppressed` remembers it).
 */
export function pulseState(
  suppressed: number | null,
  pulseKey: number | null,
  visible: boolean,
): { suppressed: number | null; show: boolean } {
  if (pulseKey === null) return { suppressed, show: false };
  if (!visible) return { suppressed: pulseKey, show: false };
  return { suppressed, show: pulseKey !== suppressed };
}

export function AgentCursor({ target, pulseKey, hidden, thinking }: AgentCursorProps) {
  const [suppressed, setSuppressed] = useState<number | null>(null);
  const pulse = pulseState(suppressed, pulseKey, target !== null && !hidden);
  if (pulse.suppressed !== suppressed) setSuppressed(pulse.suppressed);
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const at = useRef<Point | null>(null);
  const tx = target?.x ?? null;
  const ty = target?.y ?? null;

  useEffect(() => {
    const el = ref.current;
    if (!el || tx === null || ty === null) return undefined;
    const to = { x: tx, y: ty };
    const place = (p: Point) => {
      at.current = p;
      el.style.transform = `translate(${p.x - HOTSPOT.x}px, ${p.y - HOTSPOT.y}px)`;
    };
    const from = at.current;
    if (!from || reduce) {
      place(to);
      return undefined;
    }
    const control = arcControl(from, to);
    const total = travelMs(from, to);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / total);
      place(pointOnArc(from, control, to, ease(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tx, ty, reduce]);

  return (
    <div className="acur-layer" aria-hidden="true">
      <div ref={ref} className="acur" data-hidden={hidden || target === null || undefined}>
        <div className="acur-drift" data-thinking={thinking || undefined}>
          <svg viewBox="0 0 20 20" className="acur-arrow">
            <path d="M3 2 L3 16.5 L7 12.8 L9.6 18.4 L12 17.3 L9.5 11.8 L15 11.8 Z" />
          </svg>
        </div>
        <span className="acur-who">Agent</span>
      </div>
      {pulse.show ? (
        <span
          key={pulseKey}
          data-testid="click-pulse"
          className="acur-pulse"
          style={{ left: target?.x, top: target?.y }}
        />
      ) : null}
    </div>
  );
}
