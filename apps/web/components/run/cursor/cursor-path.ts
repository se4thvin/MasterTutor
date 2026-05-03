import { VIEWPORT } from "@mastertutor/contracts";
import { durations } from "@/lib/motion-tokens.ts";

interface Point {
  x: number;
  y: number;
}

/** Run 13 §6: 250–450ms depending on distance, with a slight arc. */
const MS_PER_PX = 0.35;
const ARC_RATIO = 0.2;
export const ARC_MAX_PX = 70;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function travelMs(from: Point, to: Point): number {
  return Math.min(
    durations.cursorMax,
    Math.max(durations.cursorMin, durations.cursorMin + distance(from, to) * MS_PER_PX),
  );
}

export function arcControl(from: Point, to: Point): Point {
  const d = distance(from, to);
  if (d < 1) return { x: from.x, y: from.y };
  const offset = Math.min(ARC_MAX_PX, d * ARC_RATIO);
  return {
    x: (from.x + to.x) / 2 + (-(to.y - from.y) / d) * offset,
    y: (from.y + to.y) / 2 + ((to.x - from.x) / d) * offset,
  };
}

export function pointOnArc(from: Point, control: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

/** The live frame is always 16:10, so one scale maps both axes. */
export function toViewport(point: Point, box: { width: number; height: number }): Point {
  const scale = box.width / VIEWPORT.width;
  return { x: point.x * scale, y: point.y * scale };
}
