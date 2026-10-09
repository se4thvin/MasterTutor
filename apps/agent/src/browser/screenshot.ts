import { VIEWPORT } from "@mastertutor/contracts";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { abortable, pause } from "../runtime/abortable.ts";
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
import { sharedLocalOcr, type LocalOcr } from "./local-ocr.ts";
import { screenPixels, type BandRead } from "./pixel-screen.ts";
import type { ScreenCache } from "./screen-cache.ts";
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

/**
 * Page.captureScreenshot answers when the compositor draws. A capture sent while the page swaps
 * renderer process mid-navigation can stay unanswered forever, or fail with "Not attached to an
 * active page"; a fresh capture answers at once (reproduced on a real slot: the MH sign-in hang).
 * Either way the frame is retaken, never awaited without bound.
 */
export const CAPTURE_TIMEOUT_MS = 5_000;
const SWAPPING = /Not attached to an active page|Target closed|Session closed/i;

/** The PNG as base64, or null when the page was swapping and the capture should be retaken. */
export async function captureFrame(
  session: Pick<BrowserSession, "cdp">,
  signal: AbortSignal,
  timeoutMs = CAPTURE_TIMEOUT_MS,
): Promise<string | null> {
  const cdp = await session.cdp();
  const timer = new AbortController();
  try {
    const sent = cdp
      .send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      })
      .then(
        ({ data }) => data,
        (error: unknown) => {
          if (error instanceof Error && SWAPPING.test(error.message)) return null;
          throw error;
        },
      );
    const late = delay(timeoutMs, null, { signal: timer.signal }).catch(() => null);
    return await abortable(Promise.race([sent, late]), signal);
  } finally {
    timer.abort();
  }
}

const MAX_ATTEMPTS = 3;
/** Lets a renderer swap finish before a capture is retaken. */
const RETAKE_PAUSE_MS = 100;
/** How long an observation waits for a main-frame navigation before stopping it. */
const STUCK_NAVIGATION_WAIT_MS = 5_000;

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

/** Widest scrollbar a 1:1 capture can carry beside the CSS viewport. */
const MAX_SCROLLBAR_PX = 32;

/**
 * The model image. A 1:1 capture (the deployed window) is cropped to the CSS viewport: no
 * scrollbars, whose strip a page can paint (review I2) and whose thumb moves on every scroll, and
 * no squeeze of the capture into the viewport width (model x = CSS x). Any other capture (zoom,
 * a resized window) is fitted to the target size as before.
 */
async function finalize(
  raw: Buffer,
  layout: Layout,
  boxes: readonly Box[],
): Promise<ModelScreenshot> {
  const { scale, width, height } = targetSize(layout);
  const meta = await sharp(raw).metadata();
  const extraX = (meta.width ?? 0) - layout.width;
  const extraY = (meta.height ?? 0) - layout.height;
  const oneToOne =
    extraX >= 0 && extraY >= 0 && extraX <= MAX_SCROLLBAR_PX && extraY <= MAX_SCROLLBAR_PX;
  const content = oneToOne
    ? await sharp(raw)
        .extract({ left: 0, top: 0, width: layout.width, height: layout.height })
        .png()
        .toBuffer()
    : raw;
  const contentSize = oneToOne ? layout : { width: meta.width ?? 0, height: meta.height ?? 0 };
  const sized =
    contentSize.width === width && contentSize.height === height
      ? content
      : await sharp(content).resize(width, height, { fit: "fill" }).png().toBuffer();
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
 * I-1: on a run that holds secrets, the exact image the model would receive is read locally (the
 * one tesseract worker) before it leaves. Words that show a registered secret are filled; a
 * second read must then come back clean. A failed read, or a secret still readable, gives null:
 * the step's screenshot is withheld and the model is told so (fail closed, no pause). Nothing
 * outside the screened pixels reaches the model.
 */
async function screened(
  shot: ModelScreenshot,
  sources: MaskSources,
  ocr: LocalOcr,
  signal: AbortSignal,
  cache: ScreenCache<BandRead> | undefined,
): Promise<ModelScreenshot | null> {
  const first = await screenPixels(ocr, sources, shot.png, signal, { urgent: true, cache });
  if (first.kind === "clean") return shot;
  if (first.kind === "failed") return null;
  const png = await drawMasks(shot.png, first.boxes.map(pad), {
    width: shot.width,
    height: shot.height,
  });
  const again = await screenPixels(ocr, sources, png, signal, { urgent: true, cache });
  if (again.kind !== "clean") return null;
  return { ...shot, png, masked: shot.masked + first.boxes.length };
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
  /** The run's screen cache (session-browser): unchanged regions are not read again. */
  cache?: ScreenCache<BandRead>,
): Promise<ModelScreenshot> {
  // The page answers nothing while its main frame waits on a navigation that never answers.
  await session.stopStuckNavigation(signal, STUCK_NAVIGATION_WAIT_MS);
  let layout = await session.layout();
  const drop = async (reason: string = WITHHELD.moved) => {
    const dropped = await blackFrame(layout, reason);
    session.lastScale = dropped.scale;
    return dropped;
  };
  // Why the last attempt was retaken: the reason a dropped frame gives the model.
  let retake: string = WITHHELD.moved;
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
    const data = await captureFrame(session, signal);
    if (data === null) {
      retake = WITHHELD.navigating;
      await pause(RETAKE_PAUSE_MS, signal);
      continue;
    }
    const after = await collectMaskBoxes(session, sources);
    if (after.unverifiable > 0) return drop();
    if (!sameBoxes(before.boxes, after.boxes)) {
      retake = WITHHELD.moved;
      continue;
    }
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
    const shot = await screened(
      await finalize(raw, layout, after.boxes),
      sources,
      ocr,
      signal,
      cache,
    );
    if (shot === null) return drop(WITHHELD.unreadable);
    session.lastScale = shot.scale;
    return shot;
  }
  return drop(retake);
}
