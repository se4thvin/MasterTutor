import { expect, type Locator, type Page } from "@playwright/test";

export type Rgb = readonly [number, number, number];

/** n.eko's video inside the run page's live iframe. */
export const liveVideo = (page: Page): Locator =>
  page.frameLocator("iframe[title^='Remote browser']").locator("video");

export const videoWidth = (video: Locator): Promise<number> =>
  video.evaluate((v: HTMLVideoElement) => v.videoWidth);

/** The decoded frame's centre pixel (a WebRTC stream never taints the canvas). */
export function centrePixel(video: Locator): Promise<Rgb> {
  return video.evaluate((v: HTMLVideoElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(v, 0, 0);
    const d = context.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
    ).data;
    return [d[0]!, d[1]!, d[2]!] as const;
  });
}

export const isRed = ([r, g]: Rgb): boolean => r > 150 && g < 90;
export const isGreen = ([r, g]: Rgb): boolean => g > 120 && r < 90;

/** Clicks the middle of the live view; n.eko forwards it to the slot as the person's input. */
export async function clickLiveCentre(page: Page): Promise<void> {
  const input = page.frameLocator("iframe[title^='Remote browser']").locator("textarea.overlay");
  // The run's optimistic control state precedes n.eko's actual grant of input.
  await expect(input).toHaveCSS("pointer-events", "auto");
  await input.click();
  // The slot's video includes its cursor. Leave the sampled centre pixel unobscured; callers
  // still wait for the decoded frame to show the effect of this single click.
  await input.hover({ position: { x: 1, y: 1 } });
}
