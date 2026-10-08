import type { CDPSession } from "playwright-core";

/** How far around a frame's box a document there still counts as near a press point. */
export const NEAR_FRAME_MARGIN_PX = 8;

type Box = { x: number; y: number; width: number; height: number };

/** Whether `box`, grown by `margin` on every side, holds `point`. */
export function boxNear(box: Box, point: { x: number; y: number }, margin: number): boolean {
  return (
    point.x >= box.x - margin &&
    point.x <= box.x + box.width + margin &&
    point.y >= box.y - margin &&
    point.y <= box.y + box.height + margin
  );
}

/**
 * Whether the element that owns `frameId` (its iframe, in a document of `cdp`'s frame tree) could
 * be under `point` (CSS pixels in that session's viewport): its border box, grown by `margin` on
 * every side, holds the point. Its axis-aligned bounds are used, so a transformed owner counts in
 * full. A box that cannot be read (no layout, gone, another session's owner) counts as under the
 * point: fail closed.
 */
export async function ownerBoxCovers(
  cdp: CDPSession,
  frameId: string,
  point: { x: number; y: number },
  margin: number,
): Promise<boolean> {
  try {
    const { backendNodeId } = await cdp.send("DOM.getFrameOwner", { frameId });
    const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId });
    // Only an affine owner (its quad a parallelogram) is bounded by its quad; under a perspective
    // transform the painted area may lie outside it.
    const [x0, y0, x1, y1, x2, y2, x3, y3] = model.border as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    if (Math.abs(x0 + x2 - x1 - x3) > 0.5 || Math.abs(y0 + y2 - y1 - y3) > 0.5) return true;
    const xs = model.border.filter((_, index) => index % 2 === 0);
    const ys = model.border.filter((_, index) => index % 2 === 1);
    const [x, y] = [Math.min(...xs), Math.min(...ys)];
    return boxNear(
      { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
      point,
      margin,
    );
  } catch {
    return true;
  }
}
