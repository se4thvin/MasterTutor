import { VIEWPORT } from "@mastertutor/contracts";
import sharp from "sharp";
import {
  collectMaskBoxes,
  containsSecretText,
  drawMasks,
  hasCrossOriginFrames,
  hasFilledOutOfProcessFrame,
  sameBoxes,
  type Box,
  type MaskSources,
} from "./masking.ts";
import {
  screenLines,
  screensPixels,
  sharedLocalOcr,
  type LocalOcr,
  type OcrLine,
  type PixelScreen,
} from "./local-ocr.ts";
import { abortable } from "../runtime/abortable.ts";
import type { BrowserSession, Layout } from "./session.ts";

export interface ModelScreenshot {
  png: Buffer;
  width: number;
  height: number;
  /** Image pixels per CSS pixel (≤ 1). Model coordinates divide by this to reach CSS pixels. */
  scale: number;
  masked: number;
  dropped: boolean;
  /** Why a dropped screenshot was withheld, in words the model is told (null when sent). */
  withheld: string | null;
}

/** The model is told why it sees a black frame instead of the page. */
export const WITHHELD = {
  moved: "a secret field moved while it was taken",
  unreadable: "it could not be checked for saved secrets",
  navigating: "the page kept navigating while it was taken",
} as const;

const MAX_ATTEMPTS = 3;

function targetSize(layout: Layout) {
  const scale = Math.min(1, VIEWPORT.width / layout.width, VIEWPORT.height / layout.height);
  return {
    scale,
    width: Math.max(1, Math.round(layout.width * scale)),
    height: Math.max(1, Math.round(layout.height * scale)),
  };
}

async function blackPng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toBuffer();
}

async function blackFrame(layout: Layout, reason: string): Promise<ModelScreenshot> {
  const { scale, width, height } = targetSize(layout);
  return {
    png: await blackPng(width, height),
    width,
    height,
    scale,
    masked: 0,
    dropped: true,
    withheld: reason,
  };
}

/** The same frame with nothing on it, for a capture that cannot be trusted (geometry kept). */
export async function withheldScreenshot(
  shot: ModelScreenshot,
  reason: string,
): Promise<ModelScreenshot> {
  return {
    ...shot,
    png: await blackPng(shot.width, shot.height),
    masked: 0,
    dropped: true,
    withheld: reason,
  };
}

async function finalize(
  raw: Buffer,
  layout: Layout,
  boxes: readonly Box[],
): Promise<ModelScreenshot> {
  const { scale, width, height } = targetSize(layout);
  const meta = await sharp(raw).metadata();
  const sized =
    meta.width === width && meta.height === height
      ? raw
      : await sharp(raw).resize(width, height, { fit: "fill" }).png().toBuffer();
  const scaled = boxes.map((box) => ({
    x: box.x * scale,
    y: box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  }));
  const png = scaled.length > 0 ? await drawMasks(sized, scaled, { width, height }) : sized;
  return { png, width, height, scale, masked: boxes.length, dropped: false, withheld: null };
}

/**
 * I-1: on a run that holds secrets, the image the model would receive is read locally (the one
 * tesseract worker) before it leaves. Words that show a registered secret are filled; a second
 * read must then come back clean. A failed read, or a secret still readable, gives null: the
 * step's screenshot is withheld and the model is told so (fail closed, no pause).
 */
async function screened(
  shot: ModelScreenshot,
  sources: MaskSources,
  ocr: LocalOcr,
  signal: AbortSignal,
): Promise<ModelScreenshot | null> {
  const first = await screenAdaptively(ocr, sources, shot, shot.png, signal);
  if (first.kind === "clean") return shot;
  if (first.kind === "failed") return null;
  const png = await drawMasks(shot.png, first.boxes.map(pad), {
    width: shot.width,
    height: shot.height,
  });
  const again = await screenAdaptively(ocr, sources, shot, png, signal);
  if (again.kind !== "clean") return null;
  return { ...shot, png, masked: shot.masked + first.boxes.length };
}

/**
 * Tesseract misses most UI-size text (11–14 px) at 1× and reads it at 2× (QA-098, measured). The
 * screen reads the image once at 1×, then re-reads at 2× only the bands where that read found small
 * or unsure words; their hits join, 2× boxes mapped back. Pages of plain, large text pay one read.
 */
const OCR_UPSCALE = 2;
/** Lines shorter than this (image px), or holding a word read with less confidence, get the 2× look. */
const SMALL_LINE_PX = 12;
const SURE_CONFIDENCE = 85;
/** Context kept around a band, and the gap under which two bands merge into one read. */
const BAND_PAD = 6;
const BAND_GAP = 16;

/** Horizontal bands (full width) around the lines that hold a small or unsure word. */
export function closerLookBands(
  lines: readonly OcrLine[],
  size: { width: number; height: number },
): Box[] {
  const spans = lines
    .filter(
      ({ words }) =>
        // A line's tallest word is its text size: x-height-only words ("on", "a") are not small text.
        Math.max(...words.map((word) => word.box.height)) < SMALL_LINE_PX ||
        words.some((word) => (word.confidence ?? 100) < SURE_CONFIDENCE),
    )
    .map(({ words }) => {
      const top = Math.min(...words.map((word) => word.box.y));
      const bottom = Math.max(...words.map((word) => word.box.y + word.box.height));
      return [Math.max(0, top - BAND_PAD), Math.min(size.height, bottom + BAND_PAD)] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [top, bottom] of spans) {
    const last = merged.at(-1);
    if (last && top - last[1] <= BAND_GAP) last[1] = Math.max(last[1], bottom);
    else merged.push([top, bottom]);
  }
  return merged
    .filter(([top, bottom]) => bottom > top)
    .map(([top, bottom]) => ({ x: 0, y: top, width: size.width, height: bottom - top }));
}

async function screenAdaptively(
  ocr: LocalOcr,
  sources: MaskSources,
  size: { width: number; height: number },
  png: Buffer,
  signal: AbortSignal,
): Promise<PixelScreen> {
  if (!screensPixels(sources)) return { kind: "clean" };
  const read = async (image: Buffer): Promise<OcrLine[] | null> => {
    try {
      return await abortable(ocr.words(image), signal);
    } catch {
      signal.throwIfAborted();
      return null;
    }
  };
  const lines = await read(png);
  if (lines === null) return { kind: "failed" };
  const native = screenLines(sources, lines);
  if (native.kind === "failed") return native;
  const boxes = native.kind === "hit" ? [...native.boxes] : [];
  for (const band of closerLookBands(lines, size)) {
    const large = await sharp(png)
      .extract({ left: band.x, top: band.y, width: band.width, height: band.height })
      .resize(band.width * OCR_UPSCALE, band.height * OCR_UPSCALE, { kernel: "lanczos3" })
      .png()
      .toBuffer();
    const bandLines = await read(large);
    if (bandLines === null) return { kind: "failed" };
    const closer = screenLines(sources, bandLines);
    if (closer.kind === "failed") return closer;
    if (closer.kind === "hit")
      for (const box of closer.boxes)
        boxes.push({
          x: band.x + box.x / OCR_UPSCALE,
          y: band.y + box.y / OCR_UPSCALE,
          width: box.width / OCR_UPSCALE,
          height: box.height / OCR_UPSCALE,
        });
  }
  return boxes.length > 0 ? { kind: "hit", boxes } : { kind: "clean" };
}

/** OCR boxes hug the glyphs: a little margin so no antialiased edge stays readable. */
const pad = (box: Box): Box => ({
  x: Math.max(0, box.x - 3),
  y: Math.max(0, box.y - 3),
  width: box.width + 6,
  height: box.height + 6,
});

/**
 * The only way the model sees the page (spec §9): CDP Page.captureScreenshot, never Playwright's
 * screenshot/mask/caret, which inject into the live page. Masks are drawn on the image after a
 * before/after box check; a moving secret field means retake, then drop.
 */
export async function captureModelScreenshot(
  session: BrowserSession,
  sources: MaskSources,
  signal: AbortSignal,
  ocr: LocalOcr = sharedLocalOcr(),
): Promise<ModelScreenshot> {
  let layout = await session.layout();
  const drop = async (reason: string = WITHHELD.moved) => {
    const dropped = await blackFrame(layout, reason);
    session.lastScale = dropped.scale;
    return dropped;
  };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    session.guard.assertAgent(signal);
    await session.page.bringToFront();
    layout = await session.layout();
    // While vault-filled fields are on this page, inputs inside cross-origin frames cannot be
    // boxed from this target, so any such frame makes the screenshot undeliverable (R-E5).
    if (sources.nodeIds(await session.cdp()).length > 0 && (await hasCrossOriginFrames(session))) {
      return drop();
    }
    // A field the vault filled inside an out-of-process frame cannot be boxed from here either.
    if (await hasFilledOutOfProcessFrame(session, sources, signal)) return drop();
    const before = await collectMaskBoxes(session, sources);
    if (before.unverifiable > 0) return drop();
    session.guard.assertAgent(signal);
    const { data } = await (
      await session.cdp()
    ).send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const after = await collectMaskBoxes(session, sources);
    if (after.unverifiable > 0) return drop();
    if (!sameBoxes(before.boxes, after.boxes)) continue;
    // A resize between reading the layout and capturing would misalign every mask: retake.
    const raw = Buffer.from(data, "base64");
    const meta = await sharp(raw).metadata();
    const settled = await session.layout();
    if (settled.width !== layout.width || settled.height !== layout.height) continue;
    if (
      !meta.width ||
      !meta.height ||
      Math.abs(meta.width / layout.width - meta.height / layout.height) > 0.02
    ) {
      continue;
    }
    if (await containsSecretText(session, sources, signal)) return drop();
    const shot = await screened(await finalize(raw, layout, after.boxes), sources, ocr, signal);
    if (shot === null) return drop(WITHHELD.unreadable);
    session.lastScale = shot.scale;
    return shot;
  }
  return drop();
}
