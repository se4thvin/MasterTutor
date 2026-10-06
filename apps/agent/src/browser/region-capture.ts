import type { CDPSession } from "playwright-core";
import sharp from "sharp";
import {
  collectMaskBoxes,
  containsSecretText, // B3 seam: (session, sources, signal) => Promise<boolean>
  drawMasks,
  hasCrossOriginFrames,
  hasFilledOutOfProcessFrame,
  provablyNotShown,
  quadToBox,
  sameBoxes,
  type Box,
  type MaskSources,
} from "./masking.ts";
import type { PageHelpers } from "./page-helpers.ts";
import type { BrowserSession, Layout } from "./session.ts";

export interface RegionOptions {
  /** CSS pixels in document coordinates. */
  clip: Box;
  /** Image pixels per CSS pixel (spec §7.4 element shots use 2). */
  scale: number;
}

/** Spec §7.1 provenance images are bounded (preflight S9): sharp and Chromium both get sane inputs. */
export const MAX_REGION_WIDTH = 4_096;
export const MAX_REGION_PIXELS = 64_000_000;
const ATTEMPTS = 3;

/** Read-only: secret inputs anywhere (hidden ones too, since MHTML serializes them). */
export function secretFieldCountScript(_arg: null, h: PageHelpers): number {
  let count = 0;
  const visit = (root: Document | ShadowRoot, depth: number) => {
    if (depth > 6) return;
    for (const input of root.querySelectorAll("input")) if (h.isSecretField(input)) count += 1;
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) visit(host.shadowRoot, depth + 1);
    }
    for (const frame of root.querySelectorAll("iframe, frame")) {
      try {
        const doc = (frame as HTMLIFrameElement).contentDocument;
        if (doc) visit(doc, depth + 1);
      } catch {
        // Cross-origin: another target, covered by the vault's registered nodes.
      }
    }
  };
  visit(document, 0);
  return count;
}

/** Read-only: whether any secret input (in this document, its open shadow roots or same-origin frames) is pinned. */
export function pinnedSecretFieldScript(_arg: null, h: PageHelpers): boolean {
  const isPinned = (element: Element): boolean => {
    for (let at: Element | null = element; at;) {
      const position = getComputedStyle(at).position;
      if (position === "fixed" || position === "sticky") return true;
      at = at.parentElement ?? ((at.getRootNode() as ShadowRoot).host || null);
    }
    return false;
  };
  const visit = (root: Document | ShadowRoot, depth: number): boolean => {
    if (depth > 6) return false;
    for (const input of root.querySelectorAll("input"))
      if (h.isSecretField(input) && isPinned(input)) return true;
    for (const host of root.querySelectorAll("*"))
      if (host.shadowRoot && visit(host.shadowRoot, depth + 1)) return true;
    for (const frame of root.querySelectorAll("iframe, frame")) {
      try {
        const doc = (frame as HTMLIFrameElement).contentDocument;
        if (doc && visit(doc, depth + 1)) return true;
      } catch {
        // Cross-origin: withheld by the opaque-frame rule instead.
      }
    }
    return false;
  };
  return visit(document, 0);
}

/** Runs on a vault-registered node in our world: pinned like `pinned` above. */
const PINNED_NODE_FN = `function () {
  const start = this.nodeType === 1 ? this : this.parentElement;
  for (let at = start; at; ) {
    const position = getComputedStyle(at).position;
    if (position === "fixed" || position === "sticky") return true;
    at = at.parentElement ?? ((at.getRootNode()).host || null);
  }
  return false;
}`;

/**
 * A secret field pinned to the viewport (fixed or sticky: a one-time code bar, a sticky sign-in
 * strip) moves with every scroll, so no single document position masks it across a capture (I2).
 * Any doubt counts as pinned.
 */
async function hasPinnedSecretField(
  session: BrowserSession,
  sources: MaskSources,
  cdp: CDPSession,
): Promise<boolean> {
  const worlds = await session.worlds();
  if (await worlds.evaluate(pinnedSecretFieldScript, null)) return true;
  for (const backendNodeId of sources.nodeIds(cdp)) {
    const answer = await worlds
      .callOnNode<boolean>(backendNodeId, PINNED_NODE_FN, null)
      .catch(() => true);
    if (answer !== false) return true;
  }
  return false;
}

interface DomNode {
  backendNodeId: number;
  nodeName: string;
  /** Flat [name, value, name, value, …] as CDP reports them. */
  attributes?: string[];
  documentURL?: string;
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

const FRAME_OWNERS = new Set(["IFRAME", "FRAME", "OBJECT", "EMBED"]);

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** A `sandbox` without `allow-same-origin` gives the frame an opaque origin, whatever its URL (N4). */
function opaqueSandbox(node: DomNode): boolean {
  const attributes = node.attributes ?? [];
  for (let i = 0; i + 1 < attributes.length; i += 2)
    if (attributes[i]?.toLowerCase() === "sandbox")
      return !(attributes[i + 1] ?? "").toLowerCase().split(/\s+/).includes("allow-same-origin");
  return false;
}

export interface OpaqueFrames {
  /** Document boxes of the frames this page's world cannot read into. */
  boxes: Box[];
  /** Owners whose box could not be measured and that are not provably hidden (N3). */
  unverifiable: number;
}

/**
 * Every frame whose content this page's world cannot read: cross-origin, out-of-process or
 * sandboxed without allow-same-origin, in open shadow roots too, and a same-origin frame that holds
 * one (its whole box, nested to any depth). Found through the CDP DOM tree, not a page-side walk
 * (I1). Boxes are measured in the current layout, so callers measure per capture (N1).
 */
export async function opaqueFrameBoxes(
  cdp: CDPSession,
  scroll: { x: number; y: number },
): Promise<OpaqueFrames> {
  const { root } = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as {
    root: DomNode;
  };
  const main = originOf(root.documentURL);
  const owners = new Set<number>();
  const walk = (node: DomNode, topOwner: DomNode | null) => {
    if (FRAME_OWNERS.has(node.nodeName)) {
      const owner = topOwner ?? node;
      const doc = node.contentDocument;
      const readable =
        doc !== undefined &&
        !opaqueSandbox(node) &&
        (doc.documentURL?.startsWith("about:") === true || originOf(doc.documentURL) === main);
      if (!readable) owners.add(owner.backendNodeId);
      else walk(doc, owner);
    }
    for (const child of node.children ?? []) walk(child, topOwner);
    for (const shadow of node.shadowRoots ?? []) walk(shadow, topOwner);
  };
  walk(root, null);
  const boxes: Box[] = [];
  let unverifiable = 0;
  for (const backendNodeId of owners) {
    try {
      const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId });
      const box = quadToBox(model.border);
      boxes.push({ ...box, x: box.x + scroll.x, y: box.y + scroll.y });
    } catch {
      // No box: fine only when provably detached or hidden; a stale node or a CDP error is not.
      if (!(await provablyNotShown(cdp, backendNodeId))) unverifiable += 1;
    }
  }
  return { boxes, unverifiable };
}

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function bounded(clip: Box, scale: number, content: { width: number; height: number }): Box | null {
  if (![clip.x, clip.y, clip.width, clip.height, scale].every(Number.isFinite) || scale <= 0)
    return null;
  const x = Math.max(0, clip.x);
  const y = Math.max(0, clip.y);
  // Only the document exists to be captured (a viewport-sized capture cannot reach past it).
  const width = Math.min(Math.floor(clip.width), MAX_REGION_WIDTH, Math.floor(content.width - x));
  const height = Math.min(
    Math.floor(clip.height),
    Math.floor(content.height - y),
    Math.floor(MAX_REGION_PIXELS / Math.max(1, width * scale * scale)),
  );
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

/** Read-only: viewport boxes of visible position:fixed page chrome (headers, cookie bars), outermost only. */
export function fixedChromeBoxesScript(): Box[] {
  const boxes: Box[] = [];
  for (const element of document.body?.querySelectorAll("*") ?? []) {
    if (getComputedStyle(element).position !== "fixed") continue;
    let inside = false;
    for (let at = element.parentElement; at && !inside; at = at.parentElement)
      inside = getComputedStyle(at).position === "fixed";
    if (inside) continue;
    const r = element.getBoundingClientRect();
    if (r.width > 0 && r.height > 0)
      boxes.push({ x: r.left, y: r.top, width: r.width, height: r.height });
  }
  return boxes;
}

/** Scrolls without the page's smooth scrolling, so the layout read next is the one captured (N5). */
const scrollInstantly = (session: BrowserSession, to: { x: number; y: number }) =>
  session
    .worlds()
    .then((worlds) =>
      worlds.evaluate(
        (target: { x: number; y: number }) =>
          window.scrollTo({ left: target.x, top: target.y, behavior: "instant" }),
        to,
      ),
    );

/** Opaque rectangles in a neutral grey, in image pixels (fixed chrome repeated in later tiles). */
async function paintOver(png: Buffer, boxes: readonly Box[]): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const overlays = boxes
    .map((box) => {
      const left = Math.max(0, Math.floor(box.x));
      const top = Math.max(0, Math.floor(box.y));
      const right = Math.min(meta.width ?? 0, Math.ceil(box.x + box.width));
      const bottom = Math.min(meta.height ?? 0, Math.ceil(box.y + box.height));
      return { left, top, width: right - left, height: bottom - top };
    })
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => ({
      input: {
        create: {
          width: box.width,
          height: box.height,
          channels: 4 as const,
          background: { r: 238, g: 238, b: 238, alpha: 1 },
        },
      },
      left: box.left,
      top: box.top,
    }));
  return overlays.length > 0 ? sharp(png).composite(overlays).png().toBuffer() : png;
}

/** True when an opaque frame lies in the tile as laid out now, or one cannot be measured (N1, N3). */
async function opaqueFrameInTile(cdp: CDPSession, tile: Box, layout: Layout): Promise<boolean> {
  const frames = await opaqueFrameBoxes(cdp, { x: layout.scrollX, y: layout.scrollY });
  return frames.unverifiable > 0 || frames.boxes.some((frame) => intersects(frame, tile));
}

/**
 * One viewport-sized piece of the region, captured in the live layout and masked. With vault
 * material, opaque frames are measured in this tile's own layout, before and after the capture: a
 * fixed or sticky cross-origin frame moves with every scroll (N1). Fixed page chrome is painted
 * over in every tile but the first, so a tall region shows it once (N6).
 */
async function captureTile(
  session: BrowserSession,
  sources: MaskSources,
  cdp: CDPSession,
  tile: Box,
  options: { scale: number; vault: boolean; first: boolean },
  signal: AbortSignal,
): Promise<Buffer | null> {
  const { scale } = options;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    session.guard.assertAgent(signal);
    await scrollInstantly(session, { x: tile.x, y: tile.y });
    const layout = await session.layout();
    // The tile must lie inside the viewport as scrolled, or the image would not be the layout measured.
    if (
      tile.x < layout.scrollX ||
      tile.y < layout.scrollY ||
      tile.x + tile.width > layout.scrollX + layout.width + 1 ||
      tile.y + tile.height > layout.scrollY + layout.height + 1
    )
      return null;
    if (options.vault && (await opaqueFrameInTile(cdp, tile, layout))) return null;
    const before = await collectMaskBoxes(session, sources);
    if (before.unverifiable > 0) return null;
    session.guard.assertAgent(signal);
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { ...tile, scale },
    });
    const after = await collectMaskBoxes(session, sources);
    const settled = await session.layout();
    if (after.unverifiable > 0) return null;
    if (options.vault && (await opaqueFrameInTile(cdp, tile, settled))) return null;
    if (
      !sameBoxes(before.boxes, after.boxes) ||
      settled.scrollX !== layout.scrollX ||
      settled.scrollY !== layout.scrollY
    )
      continue;
    // Viewport coordinates of this very layout, to image pixels of this tile.
    const toImage = (box: Box): Box => ({
      x: (box.x + layout.scrollX - tile.x) * scale,
      y: (box.y + layout.scrollY - tile.y) * scale,
      width: box.width * scale,
      height: box.height * scale,
    });
    let png: Buffer = Buffer.from(data, "base64");
    if (!options.first) {
      const chrome = await (await session.worlds()).evaluate(fixedChromeBoxesScript, null);
      png = await paintOver(png, chrome.map(toImage));
    }
    const masks = after.boxes.map(toImage);
    if (masks.length === 0) return png;
    const meta = await sharp(png).metadata();
    return drawMasks(png, masks, { width: meta.width ?? 0, height: meta.height ?? 0 });
  }
  return null;
}

/**
 * A masked capture of a document region for stored assets (spec §7.4, §9); the model never sees it.
 * Masks are drawn on the image in the agent; nothing is injected into the page. The region is
 * captured viewport by viewport in the live layout (scrolled into view, never
 * captureBeyondViewport, whose enlarged layout the masks were not measured in: I2), then joined.
 * Returns null (withheld, never a black frame) when the region cannot be proven clean: B1's
 * screenshot gates, a cross-origin frame inside it while the run holds vault material (I1), a
 * pinned secret field, an unverifiable vault node, a moving field, or a secret in the page's text.
 */
export async function captureMaskedRegion(
  session: BrowserSession,
  sources: MaskSources,
  options: RegionOptions,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const cdp = await session.cdp();
  const metrics = await cdp.send("Page.getLayoutMetrics");
  const clip = bounded(options.clip, options.scale, metrics.cssContentSize);
  if (!clip) return null;
  session.guard.assertAgent(signal);
  // B1's gates for model screenshots (screenshot.ts), in the same order.
  if (sources.nodeIds(cdp).length > 0 && (await hasCrossOriginFrames(session))) return null; // B3 seam: nodeIds(cdp)
  if (await hasFilledOutOfProcessFrame(session, sources, signal)) return null;
  const start = await session.layout();
  const vault = sources.hasSecrets() || sources.nodeIds(cdp).length > 0; // B3 seam: nodeIds(cdp)
  if (await hasPinnedSecretField(session, sources, cdp)) return null;
  const tiles: Box[] = [];
  for (let y = clip.y; y < clip.y + clip.height; y += start.height)
    for (let x = clip.x; x < clip.x + clip.width; x += start.width)
      tiles.push({
        x,
        y,
        width: Math.min(start.width, clip.x + clip.width - x),
        height: Math.min(start.height, clip.y + clip.height - y),
      });
  const pieces: Array<{ input: Buffer; left: number; top: number }> = [];
  try {
    for (const tile of tiles) {
      const piece = await captureTile(
        session,
        sources,
        cdp,
        tile,
        { scale: options.scale, vault, first: tile === tiles[0] },
        signal,
      );
      if (!piece) return null;
      pieces.push({
        input: piece,
        left: Math.round((tile.x - clip.x) * options.scale),
        top: Math.round((tile.y - clip.y) * options.scale),
      });
    }
  } finally {
    // Put the page back where the agent left it, also after an abort or a takeover (no assert
    // here: it would skip the restore and replace the original outcome, N7).
    await scrollInstantly(session, { x: start.scrollX, y: start.scrollY }).catch(() => undefined);
  }
  if (await containsSecretText(session, sources, signal)) return null; // B3 seam: (…, signal)
  if (pieces.length === 1) return new Uint8Array(pieces[0]!.input);
  const png = await sharp({
    create: {
      width: Math.round(clip.width * options.scale),
      height: Math.round(clip.height * options.scale),
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(pieces)
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** True when the page holds anything the masker covers: secret inputs (hidden too) or vault nodes. */
export async function hasMaskTargets(
  session: BrowserSession,
  sources: MaskSources,
): Promise<boolean> {
  if (sources.nodeIds(await session.cdp()).length > 0) return true; // B3 seam: nodeIds(cdp)
  return (await (await session.worlds()).evaluate(secretFieldCountScript, null)) > 0;
}
