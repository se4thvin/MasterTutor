import type { CDPSession } from "playwright-core";

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
    const xs = model.border.filter((_, index) => index % 2 === 0);
    const ys = model.border.filter((_, index) => index % 2 === 1);
    return (
      point.x >= Math.min(...xs) - margin &&
      point.x <= Math.max(...xs) + margin &&
      point.y >= Math.min(...ys) - margin &&
      point.y <= Math.max(...ys) + margin
    );
  } catch {
    return true;
  }
}
