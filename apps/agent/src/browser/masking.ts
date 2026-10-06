import sharp from "sharp";
import type { PageHelpers } from "./page-helpers.ts";
import type { BrowserSession } from "./session.ts";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Extra mask targets owned by the vault (B3): elements it filled, and the secret values themselves. */
export interface MaskSources {
  nodeIds(): readonly number[];
  secretValues(): readonly string[];
}

export const NO_MASK_SOURCES: MaskSources = { nodeIds: () => [], secretValues: () => [] };

/** Isolated-world scan for secret inputs across same-origin frames and open shadow roots. Read-only. */
export function secretFieldBoxesScript(_arg: null, h: PageHelpers): Box[] {
  const boxes: Box[] = [];
  const visit = (root: Document | ShadowRoot, ox: number, oy: number, depth: number) => {
    if (depth > 6) return;
    for (const el of root.querySelectorAll("input")) {
      if (!h.isSecretField(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        boxes.push({ x: r.left + ox, y: r.top + oy, width: r.width, height: r.height });
    }
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) visit(host.shadowRoot, ox, oy, depth + 1);
    }
    for (const frame of root.querySelectorAll("iframe, frame")) {
      try {
        const doc = (frame as HTMLIFrameElement).contentDocument;
        if (!doc) continue;
        const r = frame.getBoundingClientRect();
        visit(
          doc,
          ox + r.left + (frame as HTMLElement).clientLeft,
          oy + r.top + (frame as HTMLElement).clientTop,
          depth + 1,
        );
      } catch {
        // Cross-origin frames are separate targets; their secret fields are B3's registered nodes.
      }
    }
  };
  visit(document, 0, 0, 0);
  return boxes;
}

function quadToBox(quad: readonly number[]): Box {
  const xs = [quad[0] ?? 0, quad[2] ?? 0, quad[4] ?? 0, quad[6] ?? 0];
  const ys = [quad[1] ?? 0, quad[3] ?? 0, quad[5] ?? 0, quad[7] ?? 0];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export async function collectMaskBoxes(
  session: BrowserSession,
  sources: MaskSources,
): Promise<Box[]> {
  const worlds = await session.worlds();
  const boxes = await worlds.evaluate(secretFieldBoxesScript, null);
  const cdp = await session.cdp();
  for (const backendNodeId of sources.nodeIds()) {
    try {
      const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId });
      boxes.push(quadToBox(model.border));
    } catch {
      // A detached node has nothing on screen to mask.
    }
  }
  return boxes;
}

export function sameBoxes(a: readonly Box[], b: readonly Box[], tolerance = 1): boolean {
  if (a.length !== b.length) return false;
  return a.every((box, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      Math.abs(box.x - other.x) <= tolerance &&
      Math.abs(box.y - other.y) <= tolerance &&
      Math.abs(box.width - other.width) <= tolerance &&
      Math.abs(box.height - other.height) <= tolerance
    );
  });
}

/** Opaque rectangles drawn in the agent, on the image, never in the page (spec §9). Boxes are in image pixels. */
export async function drawMasks(
  png: Buffer,
  boxes: readonly Box[],
  size: { width: number; height: number },
): Promise<Buffer> {
  const pad = 2;
  const overlays = boxes
    .map((box) => {
      const left = Math.max(0, Math.floor(box.x - pad));
      const top = Math.max(0, Math.floor(box.y - pad));
      const right = Math.min(size.width, Math.ceil(box.x + box.width + pad));
      const bottom = Math.min(size.height, Math.ceil(box.y + box.height + pad));
      return { left, top, width: right - left, height: bottom - top };
    })
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => ({
      input: {
        create: {
          width: box.width,
          height: box.height,
          channels: 4 as const,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      },
      left: box.left,
      top: box.top,
    }));
  if (overlays.length === 0) return png;
  return sharp(png).composite(overlays).png().toBuffer();
}

/** Final check (spec §9): any accessibility-tree name or value containing a secret drops the frame. */
export async function containsSecretText(
  session: BrowserSession,
  secrets: readonly string[],
): Promise<boolean> {
  const candidates = secrets.filter((secret) => secret.length >= 4);
  if (candidates.length === 0) return false;
  const { nodes } = await (await session.cdp()).send("Accessibility.getFullAXTree", {});
  for (const node of nodes) {
    for (const value of [node.name?.value, node.value?.value]) {
      if (typeof value === "string" && candidates.some((secret) => value.includes(secret)))
        return true;
    }
  }
  return false;
}
