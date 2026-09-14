import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { LocalOcr, OcrLine } from "./local-ocr.ts";
import type { MaskSources } from "./masking.ts";
import { lineBands, screenPixels, type BandRead } from "./pixel-screen.ts";
import { createScreenCache } from "./screen-cache.ts";

const signal = new AbortController().signal;
const WIDTH = 400;
const VIEW = 300;
/** A long page: an 18 px dark bar of a distinct grey per "line", 70 px apart. */
const BARS = [40, 110, 180, 250, 320, 390].map((y, i) => ({ y, grey: 10 * (i + 1) }));

/** The frame a 300 px viewport shows at `scrollY`. */
async function frame(scrollY: number): Promise<Uint8Array> {
  const data = Buffer.alloc(WIDTH * VIEW * 3, 255);
  for (const bar of BARS)
    for (let y = bar.y; y < bar.y + 18; y++) {
      const row = y - scrollY;
      if (row < 0 || row >= VIEW) continue;
      for (let x = 10; x < 300; x++)
        data.fill(bar.grey, (row * WIDTH + x) * 3, (row * WIDTH + x) * 3 + 3);
    }
  return new Uint8Array(
    await sharp(data, { raw: { width: WIDTH, height: VIEW, channels: 3 } })
      .png()
      .toBuffer(),
  );
}

/**
 * OCR from pixels: each run of rows holding dark pixels is one word, named by its darkest grey
 * (`words` maps a grey to text), boxed where it lies in the image read. Counts reads and heights.
 */
function pixelOcr(words: Record<number, string>) {
  const heights: number[] = [];
  const ocr: LocalOcr & { heights: number[] } = {
    heights,
    text: async () => "",
    words: async (png) => {
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      heights.push(info.height);
      const lines: OcrLine[] = [];
      let run: { top: number; grey: number; left: number; right: number } | null = null;
      for (let y = 0; y <= info.height; y++) {
        let darkest = 255;
        let left = info.width;
        let right = -1;
        for (let x = 0; y < info.height && x < info.width; x++) {
          const value = data[(y * info.width + x) * info.channels]!;
          if (value < 200) {
            darkest = Math.min(darkest, value);
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
        if (right >= 0) {
          run ??= { top: y, grey: darkest, left, right };
          run.grey = Math.min(run.grey, darkest);
        } else if (run) {
          const grey = Math.round(run.grey / 10) * 10;
          lines.push({
            words: [
              {
                text: words[grey] ?? `word${grey}`,
                confidence: 95,
                box: {
                  x: run.left,
                  y: run.top,
                  width: run.right - run.left + 1,
                  height: y - run.top,
                },
              },
            ],
          });
          run = null;
        }
      }
      return lines;
    },
  };
  return ocr;
}

function vault(): MaskSources {
  return {
    nodeIds: () => [],
    hasSecrets: () => true,
    redact: (text) => text.replaceAll("hunter2", "[secret]"),
    secretsVersion: () => 0,
  };
}

describe("lineBands", () => {
  it("cuts a frame into bands at runs of repeated rows, one context row each side", () => {
    const repeats = Array.from(
      { length: 100 },
      (_, y) => !((y >= 10 && y < 20) || (y >= 60 && y < 70)),
    );
    expect(lineBands(repeats)).toEqual([
      [9, 21],
      [59, 71],
    ]);
  });
});

describe("screenPixels with the run's cache across a scroll (screen-scroll-cache)", () => {
  it("reuses every unchanged band after a scroll and reads only the new one", async () => {
    const ocr = pixelOcr({});
    const sources = vault();
    const cache = createScreenCache<BandRead>(sources);
    await screenPixels(ocr, sources, await frame(0), signal, { urgent: true, cache });
    expect(ocr.heights).toHaveLength(1); // first view: one read
    await screenPixels(ocr, sources, await frame(70), signal, { urgent: true, cache });
    // Scrolled 70 px: bars 2–4 kept their pixels; only bar 5, new at the bottom, is read
    // (its 21 rows, with the stack's 24 blank rows below).
    expect(ocr.heights[1]).toBe(21 + 24);
    expect(ocr.heights).toHaveLength(2);
  });
  it("still catches a secret that scrolls into view", async () => {
    const ocr = pixelOcr({ 50: "pw hunter2" });
    const sources = vault();
    const cache = createScreenCache<BandRead>(sources);
    expect(
      await screenPixels(ocr, sources, await frame(0), signal, { urgent: true, cache }),
    ).toEqual({
      kind: "clean",
    });
    expect(
      await screenPixels(ocr, sources, await frame(70), signal, { urgent: true, cache }),
    ).toEqual({
      kind: "hit",
      boxes: [{ x: 10, y: 320 - 70, width: 290, height: 18 }],
    });
  });
  it("puts a reused band's redaction box where the band is now", async () => {
    const ocr = pixelOcr({ 20: "hunter2" });
    const sources = vault();
    const cache = createScreenCache<BandRead>(sources);
    const box = (y: number) => ({ kind: "hit", boxes: [{ x: 10, y, width: 290, height: 18 }] });
    expect(
      await screenPixels(ocr, sources, await frame(0), signal, { urgent: true, cache }),
    ).toEqual(box(110));
    expect(
      await screenPixels(ocr, sources, await frame(70), signal, { urgent: true, cache }),
    ).toEqual(box(40));
    expect(ocr.heights[1]).toBe(21 + 24); // the secret's band was not read again
  });
});
