import { VIEWPORT } from "@mastertutor/contracts";
import sharp from "sharp";
import {
  collectMaskBoxes,
  containsSecretText,
  drawMasks,
  hasCrossOriginFrames,
  sameBoxes,
  type Box,
  type MaskSources,
} from "./masking.ts";
import type { BrowserSession, Layout } from "./session.ts";

export interface ModelScreenshot {
  png: Buffer;
  width: number;
  height: number;
  /** Image pixels per CSS pixel (≤ 1). Model coordinates divide by this to reach CSS pixels. */
  scale: number;
  masked: number;
  dropped: boolean;
}

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

async function blackFrame(layout: Layout): Promise<ModelScreenshot> {
  const { scale, width, height } = targetSize(layout);
  return { png: await blackPng(width, height), width, height, scale, masked: 0, dropped: true };
}

/** The same frame with nothing on it, for a capture that cannot be trusted (geometry kept). */
export async function withheldScreenshot(shot: ModelScreenshot): Promise<ModelScreenshot> {
  return { ...shot, png: await blackPng(shot.width, shot.height), masked: 0, dropped: true };
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
  return { png, width, height, scale, masked: boxes.length, dropped: false };
}

/**
 * The only way the model sees the page (spec §9): CDP Page.captureScreenshot, never Playwright's
 * screenshot/mask/caret, which inject into the live page. Masks are drawn on the image after a
 * before/after box check; a moving secret field means retake, then drop.
 */
export async function captureModelScreenshot(
  session: BrowserSession,
  sources: MaskSources,
  signal: AbortSignal,
): Promise<ModelScreenshot> {
  let layout = await session.layout();
  const drop = async () => {
    const dropped = await blackFrame(layout);
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
    if (await containsSecretText(session, sources)) return drop();
    const shot = await finalize(raw, layout, after.boxes);
    session.lastScale = shot.scale;
    return shot;
  }
  return drop();
}
