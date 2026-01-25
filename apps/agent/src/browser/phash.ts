import sharp from "sharp";

const SIZE = 32;
const LOW = 8;
const COS: number[][] = Array.from({ length: LOW }, (_, frequency) =>
  Array.from({ length: SIZE }, (_, position) =>
    Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * SIZE)),
  ),
);

/** 64-bit DCT perceptual hash, used for loop detection (spec §5.5) and keyframes (B4). */
export async function perceptualHash(png: Uint8Array): Promise<bigint> {
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
      let sum = 0;
      const rowCos = COS[u] ?? [];
      const colCos = COS[v] ?? [];
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++)
          sum += (rowCos[y] ?? 0) * (colCos[x] ?? 0) * (pixels[y * SIZE + x] ?? 0);
      }
      coefficients.push(sum);
    }
  }
  const ac = coefficients.slice(1).sort((a, b) => a - b);
  const median = ac[Math.floor(ac.length / 2)] ?? 0;
  let hash = 0n;
  for (const coefficient of coefficients) hash = (hash << 1n) | (coefficient > median ? 1n : 0n);
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
