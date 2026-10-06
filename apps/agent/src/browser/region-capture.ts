import sharp from "sharp";
import {
  collectMaskBoxes,
  containsSecretText, // B3 seam: (session, sources, signal) => Promise<boolean>
  drawMasks,
  sameBoxes,
  type Box,
  type MaskSources,
} from "./masking.ts";
import type { PageHelpers } from "./page-helpers.ts";
import type { BrowserSession } from "./session.ts";

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

/** Read-only: document boxes of frames this world cannot read into (other CDP targets). */
export function opaqueFrameBoxesScript(): Box[] {
  const boxes: Box[] = [];
  for (const frame of document.querySelectorAll("iframe, frame, object, embed")) {
    let readable: boolean;
    try {
      readable = (frame as HTMLIFrameElement).contentDocument != null;
    } catch {
      readable = false;
    }
    if (readable) continue;
    const r = frame.getBoundingClientRect();
    if (r.width > 0 && r.height > 0)
      boxes.push({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height });
  }
  return boxes;
}

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

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function bounded(clip: Box, scale: number): Box | null {
  if (![clip.x, clip.y, clip.width, clip.height, scale].every(Number.isFinite) || scale <= 0)
    return null;
  const width = Math.min(Math.floor(clip.width), MAX_REGION_WIDTH);
  const height = Math.min(
    Math.floor(clip.height),
    Math.floor(MAX_REGION_PIXELS / Math.max(1, width * scale * scale)),
  );
  if (width < 1 || height < 1) return null;
  return { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width, height };
}

/**
 * A masked capture of a document region for stored assets (spec §7.4, §9); the model never sees it.
 * Masks are drawn on the image in the agent; nothing is injected into the page. Returns null
 * (withheld, never a black frame) when the region cannot be proven clean: a cross-origin frame
 * inside it while the run holds vault material, an unverifiable vault node, a moving secret field,
 * or a secret in the page's text (preflight F7, Q6).
 */
export async function captureMaskedRegion(
  session: BrowserSession,
  sources: MaskSources,
  options: RegionOptions,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const clip = bounded(options.clip, options.scale);
  if (!clip) return null;
  const cdp = await session.cdp();
  const vault = sources.hasSecrets() || sources.nodeIds(cdp).length > 0; // B3 seam: nodeIds(cdp)
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    session.guard.assertAgent(signal);
    const layout = await session.layout();
    if (vault) {
      const frames = await (await session.worlds()).evaluate(opaqueFrameBoxesScript, null);
      if (frames.some((frame) => intersects(frame, clip))) return null;
    }
    const before = await collectMaskBoxes(session, sources);
    if (before.unverifiable > 0) return null;
    session.guard.assertAgent(signal);
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { ...clip, scale: options.scale },
    });
    const after = await collectMaskBoxes(session, sources);
    const settled = await session.layout();
    if (after.unverifiable > 0) return null;
    if (
      !sameBoxes(before.boxes, after.boxes) ||
      settled.scrollX !== layout.scrollX ||
      settled.scrollY !== layout.scrollY
    )
      continue;
    if (await containsSecretText(session, sources, signal)) return null; // B3 seam: (…, signal)
    const raw = Buffer.from(data, "base64");
    const meta = await sharp(raw).metadata();
    const boxes = after.boxes.map((box) => ({
      x: (box.x + layout.scrollX - clip.x) * options.scale,
      y: (box.y + layout.scrollY - clip.y) * options.scale,
      width: box.width * options.scale,
      height: box.height * options.scale,
    }));
    const png =
      boxes.length > 0
        ? await drawMasks(raw, boxes, { width: meta.width ?? 0, height: meta.height ?? 0 })
        : raw;
    return new Uint8Array(png);
  }
  return null;
}

/** True when the page holds anything the masker covers: secret inputs (hidden too) or vault nodes. */
export async function hasMaskTargets(
  session: BrowserSession,
  sources: MaskSources,
): Promise<boolean> {
  if (sources.nodeIds(await session.cdp()).length > 0) return true; // B3 seam: nodeIds(cdp)
  return (await (await session.worlds()).evaluate(secretFieldCountScript, null)) > 0;
}
