import { marquee } from "@/lib/motion-tokens.ts";

/**
 * Pure rules behind <MarqueeText>: when a label counts as truncated, how far and how long it
 * glides, and what a hover or keyboard focus does under each motion preference.
 */

/** Sub-pixel slack, so a label that only rounds past its box is not treated as truncated. */
const TOLERANCE_PX = 1;

export interface MarqueeMeasure {
  overflowing: boolean;
  /** How far the text moves to bring its end into view, past the trailing fade. 0 at rest. */
  shift: number;
}

export function measureMarquee(
  boxWidth: number,
  textWidth: number,
  fadePx: number,
): MarqueeMeasure {
  const overflow = textWidth - boxWidth;
  if (boxWidth <= 0 || overflow <= TOLERANCE_PX) return { overflowing: false, shift: 0 };
  return { overflowing: true, shift: Math.ceil(overflow + fadePx) };
}

/** Travel time for one direction, at a reading pace, clamped. */
export function travelMs(shift: number): number {
  const ms = (shift / marquee.pxPerSecond) * 1000;
  return Math.round(Math.min(marquee.maxTravelMs, Math.max(marquee.minTravelMs, ms)));
}

type MarqueeAction = "glide" | "tooltip" | "none";

/**
 * A truncated label glides on hover or keyboard focus. Under reduced motion nothing moves: keyboard
 * focus shows the full name in a tooltip, and hover has the native `title` tooltip.
 */
export function marqueeAction(
  overflowing: boolean,
  reducedMotion: boolean,
  via: "hover" | "focus",
): MarqueeAction {
  if (!overflowing) return "none";
  if (!reducedMotion) return "glide";
  return via === "focus" ? "tooltip" : "none";
}

/** One glide: rest, travel to the end, rest, travel back (transform only, so zero layout). */
export function glide(shift: number, rtl: boolean): { keyframes: Keyframe[]; durationMs: number } {
  const travel = travelMs(shift);
  const total = 2 * marquee.holdMs + 2 * travel;
  const at = (ms: number) => ms / total;
  const end = `translateX(${rtl ? shift : -shift}px)`;
  const easing = `cubic-bezier(${marquee.easing.join(", ")})`;
  return {
    durationMs: total,
    keyframes: [
      { offset: 0, transform: "translateX(0)" },
      { offset: at(marquee.holdMs), transform: "translateX(0)", easing },
      { offset: at(marquee.holdMs + travel), transform: end },
      { offset: at(2 * marquee.holdMs + travel), transform: end, easing },
      { offset: 1, transform: "translateX(0)" },
    ],
  };
}
