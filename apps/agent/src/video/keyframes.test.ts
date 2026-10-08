import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { KeyframeSampler, meanLuminance } from "./keyframes.ts";

const png = (n: number) => new Uint8Array([n]);

describe("KeyframeSampler", () => {
  it("keeps the last frame before each change, measured against the segment's first frame", () => {
    const s = new KeyframeSampler(6);
    [0n, 1n, 3n, 0xffffn, 0xfffen, 0xff00ff00n].forEach((hash, i) =>
      s.push({ t: i * 2, hash, png: png(i) }),
    );
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
