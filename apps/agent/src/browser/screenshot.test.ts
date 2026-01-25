import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { drawMasks, sameBoxes } from "./masking.ts";
import { hammingDistance, perceptualHash } from "./phash.ts";

const white = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png()
    .toBuffer();

async function pixel(png: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}

describe("drawMasks", () => {
  it("paints opaque padded boxes and clips them to the image", async () => {
    const masked = await drawMasks(
      await white(100, 50),
      [
        { x: 10, y: 10, width: 20, height: 10 },
        { x: 90, y: 40, width: 50, height: 50 },
      ],
      { width: 100, height: 50 },
    );
    expect(await pixel(masked, 15, 15)).toEqual([0, 0, 0]);
    expect(await pixel(masked, 9, 9)).toEqual([0, 0, 0]);
    expect(await pixel(masked, 50, 25)).toEqual([255, 255, 255]);
    expect(await pixel(masked, 99, 49)).toEqual([0, 0, 0]);
  });
});

describe("sameBoxes", () => {
  it("tolerates sub-pixel jitter but not movement or new boxes", () => {
    const a = [{ x: 10, y: 10, width: 20, height: 10 }];
    expect(sameBoxes(a, [{ x: 10.4, y: 10, width: 20, height: 10 }])).toBe(true);
    expect(sameBoxes(a, [{ x: 17, y: 10, width: 20, height: 10 }])).toBe(false);
    expect(sameBoxes(a, [...a, { x: 0, y: 0, width: 1, height: 1 }])).toBe(false);
  });
});

describe("perceptualHash", () => {
  it("is stable for the same image and far for different ones", async () => {
    const base = await white(200, 100);
    const striped = await sharp(base)
      .composite([
        {
          input: {
            create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
          },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const a = await perceptualHash(striped);
    expect(hammingDistance(a, await perceptualHash(striped))).toBe(0);
    expect(hammingDistance(a, await perceptualHash(base))).toBeGreaterThan(10);
  });
});
