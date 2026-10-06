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

/**
 * Extra mask targets owned by the vault (B3). Plaintext never crosses this seam: the vault keeps
 * only keyed digests and answers with node ids and a redactor.
 */
export interface MaskSources {
  /** backendNodeIds, in `cdp`'s target, of fields the vault filled in documents still loaded. */
  nodeIds(cdp: CDPSession): readonly number[];
  /** True while the run has secret values registered (the text scan runs only then). */
  hasSecrets(): boolean;
  /** `text` with every registered secret value replaced by SECRET_REDACTION; `text` itself when none occurs. */
  redact(text: string): string;
}

export const SECRET_REDACTION = "[secret]";

export const NO_MASK_SOURCES: MaskSources = {
  nodeIds: () => [],
  hasSecrets: () => false,
  redact: (text) => text,
};

export function containsSecret(sources: MaskSources, text: string): boolean {
  return sources.redact(text) !== text;
}

/** Every string inside a tool result (JSON data) with registered secrets redacted (M13). */
export function redactDeep(value: unknown, sources: MaskSources): unknown {
  if (!sources.hasSecrets()) return value;
  if (typeof value === "string") return sources.redact(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, sources));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDeep(item, sources)]),
    );
  return value;
}

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

/** A node whose document was replaced (a navigation) still describes, but no longer resolves (F8). */
const GONE_DOCUMENT = /does not belong to the document/i;

/** True only when the node is provably not on screen; any doubt (other target, error, visible) is false. */
async function provablyNotShown(cdp: CDPSession, backendNodeId: number): Promise<boolean> {
  try {
    await cdp.send("DOM.describeNode", { backendNodeId });
    let resolved;
    try {
      resolved = await cdp.send("DOM.resolveNode", { backendNodeId });
    } catch (error) {
      return error instanceof Error && GONE_DOCUMENT.test(error.message);
    }
    if (!resolved.object.objectId) return false;
    const result = await cdp.send("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
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
  for (const backendNodeId of sources.nodeIds(cdp)) {
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

interface FrameNode {
  frame: { id: string; url?: string; securityOrigin?: string };
  childFrames?: FrameNode[];
}

function flattenFrames(node: FrameNode, out: FrameNode["frame"][] = []): FrameNode["frame"][] {
  out.push(node.frame);
  for (const child of node.childFrames ?? []) flattenFrames(child, out);
  return out;
}

/**
 * True when any frame is on a different origin from the main frame (its inputs are another CDP
 * target). Out-of-process frames are missing from the page target's frame tree, so they are
 * counted separately: site isolation only moves cross-site, hence cross-origin, frames.
 */
export async function hasCrossOriginFrames(session: BrowserSession): Promise<boolean> {
  const { frameTree } = await (await session.cdp()).send("Page.getFrameTree");
  const frames = flattenFrames(frameTree as FrameNode);
  const main = frames[0]?.securityOrigin;
  // about:srcdoc and about:blank frames inherit the parent's origin (Chromium reports "://" for them).
  if (
    frames
      .slice(1)
      .some((frame) => !frame.url?.startsWith("about:") && frame.securityOrigin !== main)
  )
    return true;
  return (await session.outOfProcessFrames()).size > 0;
}

type AxText = { name?: { value?: unknown }; value?: { value?: unknown } };

/** One frame's accessibility tree; out-of-process frames through their own target (R-E5). */
async function frameAxNodes(
  session: BrowserSession,
  cdp: CDPSession,
  frameId: string,
): Promise<readonly AxText[] | null> {
  try {
    return (await cdp.send("Accessibility.getFullAXTree", { frameId })).nodes;
  } catch {
    const own = await session.frameCdp(frameId).catch(() => null);
    if (!own) return null;
    try {
      return (await own.send("Accessibility.getFullAXTree", {})).nodes;
    } catch {
      return null;
    }
  }
}

function hasSecretText(nodes: readonly AxText[], sources: MaskSources): boolean {
  return nodes.some((node) =>
    [node.name?.value, node.value?.value].some(
      (value) => typeof value === "string" && containsSecret(sources, value),
    ),
  );
}

/**
 * Final check (spec §9): any accessibility-tree name or value, in every frame, containing a
 * registered secret drops the frame. A frame whose tree cannot be read either way fails closed.
 * The page target's frame tree omits out-of-process frames, so each of those targets (and the
 * frames it hosts) is scanned through its own CDP session.
 */
export async function containsSecretText(
  session: BrowserSession,
  sources: MaskSources,
): Promise<boolean> {
  if (!sources.hasSecrets()) return false;
  const cdp = await session.cdp();
  const { frameTree } = await cdp.send("Page.getFrameTree");
  for (const frame of flattenFrames(frameTree as FrameNode)) {
    const nodes = await frameAxNodes(session, cdp, frame.id);
    if (nodes === null || hasSecretText(nodes, sources)) return true;
  }
  for (const worlds of (await session.outOfProcessFrames()).values()) {
    const own = worlds.cdp;
    const tree = await own.send("Page.getFrameTree").catch(() => null);
    if (!tree) return true;
    for (const frame of flattenFrames(tree.frameTree as FrameNode)) {
      const nodes = await own
        .send("Accessibility.getFullAXTree", { frameId: frame.id })
        .then((result) => result.nodes)
        .catch(() => null);
      if (nodes === null || hasSecretText(nodes, sources)) return true;
    }
  }
  return false;
}
