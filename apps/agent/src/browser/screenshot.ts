import { VIEWPORT } from "@mastertutor/contracts";
import sharp from "sharp";
import {
  collectMaskBoxes,
  containsSecretText,
  drawMasks,
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

async function blackFrame(layout: Layout): Promise<ModelScreenshot> {
  const { scale, width, height } = targetSize(layout);
  const png = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  return { png, width, height, scale, masked: 0, dropped: true };
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
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    session.guard.assertAgent(signal);
    await session.page.bringToFront();
    layout = await session.layout();
    const before = await collectMaskBoxes(session, sources);
    session.guard.assertAgent(signal);
    const { data } = await (
      await session.cdp()
    ).send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const after = await collectMaskBoxes(session, sources);
    if (!sameBoxes(before, after)) continue;
    const secrets = sources.secretValues();
    const shot =
      secrets.length > 0 && (await containsSecretText(session, secrets))
        ? await blackFrame(layout)
        : await finalize(Buffer.from(data, "base64"), layout, after);
    session.lastScale = shot.scale;
    return shot;
  }
  const dropped = await blackFrame(layout);
  session.lastScale = dropped.scale;
  return dropped;
}
