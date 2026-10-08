import sharp from "sharp";

const SIZE = 32;
const LOW = 8;
const COS: number[][] = Array.from({ length: LOW }, (_, frequency) =>
  Array.from({ length: SIZE }, (_, position) =>
    Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * SIZE)),
  ),
);

/**
 * A frame's perceptual fingerprint: the 63 low-frequency AC coefficients of the DCT of a 32×32
 * grey thumbnail (the DC term is dropped, so a uniform brightness shift does not count).
 */
export type PerceptualHash = readonly number[];

/** For a frame that says nothing about the page (withheld, black): never the same as any frame. */
export const UNCOMPARABLE_HASH: PerceptualHash = [];

/**
 * At or below this distance two frames show the same thing. Measured on real VP8 encodes of flat
 * slides (tests/fixtures/phash): one slide's frames stay ≤ 1.4 apart, different slides ≥ 8.6.
 */
export const PERCEPTUAL_SAME = 3.5;

/** Used for loop detection (spec §5.5) and keyframes (B4). */
export async function perceptualHash(png: Uint8Array): Promise<PerceptualHash> {
  const pixels = await sharp(png)
    .flatten({ background: "#ffffff" })
    .resize(SIZE, SIZE, { fit: "fill" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  if (pixels.length !== SIZE * SIZE)
    throw new Error(`unexpected pHash buffer length ${pixels.length}`);
  const coefficients: number[] = [];
  for (let u = 0; u < LOW; u++) {
    for (let v = 0; v < LOW; v++) {
      if (u === 0 && v === 0) continue;
      let sum = 0;
      const rowCos = COS[u] ?? [];
      const colCos = COS[v] ?? [];
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++)
          sum += (rowCos[y] ?? 0) * (colCos[x] ?? 0) * (pixels[y * SIZE + x] ?? 0);
      }
      coefficients.push(sum / SIZE);
    }
  }
  return coefficients;
}

/**
 * Mean absolute difference of the coefficients (B4 review I6). The earlier median-bit hash flipped
 * bits on flat, low-texture frames such as lecture slides, where most coefficients sit near the
 * median and codec refinement crosses it: up to 26 of 64 bits within one static slide.
 */
export function perceptualDistance(a: PerceptualHash, b: PerceptualHash): number {
  if (a.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
}
