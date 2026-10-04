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

describe("KeyframeSampler with a second check (final review I5)", () => {
  it("keeps a frame the hash calls the same when the caller says it is not", () => {
    const s = new KeyframeSampler(3);
    s.push({ t: 0, hash: [0], png: png(0) });
    expect(s.candidate([1])).toEqual(png(0));
    s.push({ t: 2, hash: [1], png: png(1) }, false); // same layout, other text
    expect(s.candidate([40])).toBeNull();
    expect(s.finish().map((f) => [f.segmentStart, f.t])).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(s.dropped).toBe(0);
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
