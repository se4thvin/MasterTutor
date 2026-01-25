import type { CDPSession } from "playwright-core";
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

export interface MaskScan {
  boxes: Box[];
  /** Registered nodes whose box could not be computed and that are not provably detached or hidden. */
  unverifiable: number;
}

/** Runs in the page's main world, read-only: why a node without a box model has nothing to mask. */
const NODE_STATE_SCRIPT = `function () {
  if (!this.isConnected) return "detached";
  const el = this.nodeType === 1 ? this : this.parentElement;
  if (!el) return "detached";
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return "hidden";
  return "visible";
}`;

/** True only when the node is provably not on screen; any doubt (other target, error, visible) is false. */
async function provablyNotShown(cdp: CDPSession, backendNodeId: number): Promise<boolean> {
  try {
    await cdp.send("DOM.describeNode", { backendNodeId });
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId });
    if (!object.objectId) return false;
    const result = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: NODE_STATE_SCRIPT,
      returnByValue: true,
    });
    return result.result.value === "detached" || result.result.value === "hidden";
  } catch {
    return false;
  }
}

export async function collectMaskBoxes(
  session: BrowserSession,
  sources: MaskSources,
): Promise<MaskScan> {
  const worlds = await session.worlds();
  const boxes = await worlds.evaluate(secretFieldBoxesScript, null);
  const cdp = await session.cdp();
  let unverifiable = 0;
  for (const backendNodeId of sources.nodeIds()) {
    try {
      const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId });
      boxes.push(quadToBox(model.border));
    } catch {
      // No box model: fine only when the node is provably detached or hidden. A vault node in
      // another CDP target (cross-origin frame) or any other error must not ship an unmasked frame.
      if (!(await provablyNotShown(cdp, backendNodeId))) unverifiable += 1;
    }
  }
  return { boxes, unverifiable };
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

/**
 * Secrets of 1-3 characters that are all digits match almost every number on a page, so they are
 * not scanned for (their fields are still masked by box). Everything else is scanned, including
 * short non-numeric secrets: over-dropping a frame is the safe failure.
 */
export function isScannableSecret(secret: string): boolean {
  return secret.length > 0 && !(secret.length < 4 && /^\d+$/.test(secret));
}

interface FrameNode {
  frame: { id: string; url?: string; securityOrigin?: string };
  childFrames?: FrameNode[];
}

function flattenFrames(node: FrameNode, out: FrameNode["frame"][] = []): FrameNode["frame"][] {
  out.push(node.frame);
  for (const child of node.childFrames ?? []) flattenFrames(child, out);
  return out;
}

/** True when any frame is on a different origin from the main frame (its inputs are another CDP target). */
export async function hasCrossOriginFrames(session: BrowserSession): Promise<boolean> {
  const { frameTree } = await (await session.cdp()).send("Page.getFrameTree");
  const frames = flattenFrames(frameTree as FrameNode);
  const main = frames[0]?.securityOrigin;
  // about:srcdoc and about:blank frames inherit the parent's origin (Chromium reports "://" for them).
  return frames
    .slice(1)
    .some((frame) => !frame.url?.startsWith("about:") && frame.securityOrigin !== main);
}

/**
 * Final check (spec §9): any accessibility-tree name or value, in every frame, containing a
 * secret drops the frame. A frame whose tree cannot be read (e.g. out-of-process) fails closed.
 */
export async function containsSecretText(
  session: BrowserSession,
  secrets: readonly string[],
): Promise<boolean> {
  const candidates = secrets.filter(isScannableSecret);
  if (candidates.length === 0) return false;
  const cdp = await session.cdp();
  const { frameTree } = await cdp.send("Page.getFrameTree");
  for (const frame of flattenFrames(frameTree as FrameNode)) {
    let nodes;
    try {
      ({ nodes } = await cdp.send("Accessibility.getFullAXTree", { frameId: frame.id }));
    } catch {
      return true;
    }
    for (const node of nodes) {
      for (const value of [node.name?.value, node.value?.value]) {
        if (typeof value === "string" && candidates.some((secret) => value.includes(secret)))
          return true;
      }
    }
  }
  return false;
}
