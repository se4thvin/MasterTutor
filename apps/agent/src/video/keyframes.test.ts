import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { KeyframeSampler, meanLuminance } from "./keyframes.ts";

const png = (n: number) => new Uint8Array([n]);

describe("KeyframeSampler", () => {
  it("keeps the last frame before each change, measured against the segment's first frame", () => {
    const s = new KeyframeSampler(3);
    // Slow drift stays one segment while each frame is near its segment's first frame.
    [[0], [1], [3], [20], [22], [40]].forEach((hash, i) => s.push({ t: i * 2, hash, png: png(i) }));
    expect(s.finish().map((f) => [f.segmentStart, f.t])).toEqual([
      [0, 4],
      [6, 8],
      [10, 10],
    ]);
    expect(s.dropped).toBe(3);
  });
});

describe("meanLuminance", () => {
  it("measures luminance", async () => {
    const solid = (background: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background } })
        .png()
        .toBuffer();
    expect(await meanLuminance(new Uint8Array(await solid("#000")))).toBeLessThan(0.03);
    expect(await meanLuminance(new Uint8Array(await solid("#fff")))).toBeGreaterThan(0.9);
  });
});
