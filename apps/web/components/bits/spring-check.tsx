"use client";
/*
 * Adapted from React Bits "SpringCheck" (TS-TW), https://reactbits.dev/r/SpringCheck-TS-TW.json
 * (sha256 187d903812f228bd102fb760bb52342bdcb55ae2d9bce84c38cb23765b21c155, fetched 2026-10-05).
 * Copyright (c) David Haz. MIT + Commons Clause; see
 * ./LICENSE-react-bits. Adaptations: tokens; shared spring; m.* under LazyMotion; the tick fades and
 * scales (transform/opacity) instead of animating stroke-dashoffset; hugeicons removed; props trimmed.
 */
import { animate, m, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";
import { transitions } from "@/lib/motion-tokens.ts";

const SWELL = 0.35;
const RULE_END = 0.84;
const STRIKE_LAG = 0.12;
const DONE_OPACITY = 0.42;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function SpringCheck({
  label,
  doneLabel,
  checked,
  onCheckedChange,
  disabled = false,
  strike = false,
}: {
  label: string;
  doneLabel?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  strike?: boolean;
}) {
  const reduce = useReducedMotion();
  const t = useMotionValue(checked ? 1 : 0);
  const fill = useTransform(t, (v) => Math.max(v, 0));
  const box = useTransform(t, (v) => 1 + SWELL * Math.max(0, v - 1));
  const tickOpacity = useTransform(t, (v) => clamp01(v));
  const tickScale = useTransform(t, (v) => 0.6 + 0.4 * clamp01(v));
  const rule = useTransform(t, (v) => clamp01((clamp01(v) - STRIKE_LAG) / (RULE_END - STRIKE_LAG)));
  const word = useTransform(t, (v) => 1 - (1 - DONE_OPACITY) * clamp01(v));

  useEffect(() => {
    const target = checked ? 1 : 0;
    if (reduce) {
      t.jump(target);
      return undefined;
    }
    const controls = animate(t, target, transitions.spring);
    return () => controls.stop();
  }, [checked, reduce, t]);

  const text = checked && doneLabel ? doneLabel : label;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={text}
      // aria-disabled, not disabled: a disabled button drops keyboard focus to <body>.
      aria-disabled={disabled || undefined}
      className="scheck"
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
    >
      <m.span className="scheck-box" style={{ scale: box }}>
        <span className="scheck-ring" aria-hidden="true" />
        <m.span className="scheck-fill" aria-hidden="true" style={{ scale: fill }} />
        <m.svg
          className="scheck-tick"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ opacity: tickOpacity, scale: tickScale }}
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </m.svg>
      </m.span>
      <span className="scheck-label">
        <m.span style={{ opacity: strike ? word : 1 }}>{text}</m.span>
        {strike ? (
          <m.span className="scheck-rule" aria-hidden="true" style={{ scaleX: rule }} />
        ) : null}
      </span>
    </button>
  );
}
