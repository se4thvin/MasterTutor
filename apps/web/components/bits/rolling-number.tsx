"use client";
/*
 * Adapted from React Bits "Counter" (TS-TW).
 * Source:  https://reactbits.dev/r/Counter-TS-TW.json
 * sha256:  ff178ab4aa0f591bcd76eb1417ca8941c907154b95283f2db9c138938a90d9a1 (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: takes an already formatted string (currency, separators, %, "–") instead of a
 * number and place values; each digit is a 0–9 strip moved with `translate` by a CSS spring
 * transition (no per-frame JS; Counter ran a useSpring per digit); on mount it rolls up from 0
 * (CountUp's entrance) unless reduced motion is on; the gradient masks, font-size, padding and
 * colour props are removed (tokens and tabular-nums in components.css .rnum); the value is given to
 * assistive technology once, as text, and the columns are aria-hidden.
 */
import { useReducedMotion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import { cx } from "@/lib/cx.ts";

const DIGITS = "0123456789";

export function rollingParts(
  value: string,
): Array<{ key: string; digit: number | null; char: string }> {
  const chars = [...value];
  return chars.map((char, i) => {
    const digit = DIGITS.indexOf(char);
    const fromRight = chars.length - 1 - i;
    return digit >= 0
      ? { key: `${fromRight}-d`, digit, char }
      : { key: `${fromRight}-${char}`, digit: null, char };
  });
}

export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const reduce = useReducedMotion();
  // First frame shows zeros, then the strips roll to the value (the entrance).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const live = mounted || reduce === true;
  return (
    <span className={cx("rnum", className)}>
      <span className="sr-only">{value}</span>
      <span className="rnum-track" aria-hidden="true" data-qa-allow-clip="">
        {rollingParts(value).map((part) =>
          part.digit === null ? (
            <span key={part.key} className="rnum-char">
              {part.char}
            </span>
          ) : (
            <span key={part.key} className="rnum-col">
              <span
                className="rnum-strip"
                style={{ "--d": live ? part.digit : 0 } as CSSProperties}
              >
                {[...DIGITS].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          ),
        )}
      </span>
    </span>
  );
}
