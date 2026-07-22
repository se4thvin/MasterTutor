import type { Point } from "../cursor/cursor-path.ts";

export interface Box {
  width: number;
  height: number;
}
export interface Placement {
  left: number;
  top: number;
  line: { x1: number; y1: number; x2: number; y2: number };
}

/** Leader length between label and target (cutaway style, mockup D). */
export const CALLOUT_GAP = 40;
const EDGE = 8;
const NUDGE = 16;

/** Keeps the label and its leader inside the frame, so the leader never crosses the timeline (D22). */
export function calloutPlacement(target: Point, box: Box, label: Box): Placement {
  let left = target.x + NUDGE;
  if (left + label.width > box.width - EDGE) left = target.x - NUDGE - label.width;
  left = Math.min(Math.max(left, EDGE), Math.max(EDGE, box.width - EDGE - label.width));
  let top = target.y - CALLOUT_GAP - label.height;
  const below = top < EDGE;
  if (below) top = target.y + CALLOUT_GAP;
  top = Math.min(Math.max(top, EDGE), Math.max(EDGE, box.height - EDGE - label.height));
  const anchorX = Math.min(Math.max(target.x, left), left + label.width);
  return {
    left,
    top,
    line: { x1: anchorX, y1: below ? top : top + label.height, x2: target.x, y2: target.y },
  };
}
