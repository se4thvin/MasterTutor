import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ControlGuard } from "../browser/guard.ts";
import { NO_MASK_SOURCES } from "../browser/masking.ts";
import { pageCaptionsState, pageVideoSeek, pageVideoState } from "./page/player.ts";

/** The frame on screen at the player's current time (set by the fake seek). */
let now = 0;
let frameAt: (t: number) => Uint8Array | null = () => null;
vi.mock("../browser/region-capture.ts", () => ({
  captureMaskedRegion: async () => frameAt(now),
}));
const { sampleKeyframes } = await import("./keyframes.ts");

const solid = async (background: string) =>
  new Uint8Array(
    await sharp({ create: { width: 64, height: 36, channels: 3, background } })
      .png()
      .toBuffer(),
  );
let black: Uint8Array;
let slides: Uint8Array[];
beforeAll(async () => {
  black = await solid("#000");
  // Distinct, bright slides: a quadrant pattern per slide.
  slides = await Promise.all(
    [0, 1, 2, 3].map(
      async (i) =>
        new Uint8Array(
          await sharp({ create: { width: 64, height: 36, channels: 3, background: "#fff" } })
            .composite([
              {
                input: { create: { width: 32, height: 18, channels: 3, background: "#222" } },
                left: (i % 2) * 32,
                top: Math.floor(i / 2) * 18,
              },
            ])
            .png()
            .toBuffer(),
        ),
    ),
  );
});

/** A 20 s player: `seeks(t)` decides whether a seek lands; `visible(t)` whether the video has a box. */
function player(
  options: { seeks?: (t: number) => boolean; visible?: (t: number) => boolean } = {},
) {
  now = 0;
  return {
    call: async (fn: unknown, args: unknown[]) => {
      if (fn === pageVideoSeek) {
        const t = args[0] as number;
        if (!(options.seeks?.(t) ?? true)) return false;
        now = t;
        return true;
      }
      if (fn === pageVideoState)
        return {
          found: true,
          duration: 20,
          currentTime: now,
          paused: true,
          muted: false,
          ended: false,
          rect: (options.visible?.(now) ?? true) ? { x: 0, y: 0, width: 64, height: 36 } : null,
        };
      if (fn === pageCaptionsState) return { present: false, pressed: false, disabled: false };
      return true;
    },
  } as never;
}
/** Local OCR stand-in: every frame reads `textAt(now)`; null throws (a failed read). */
let textAt: (t: number) => string | null = () => "";
const ocrCalls: number[] = [];
const ctx = () => ({
  session: { guard: new ControlGuard() } as never,
  mask: NO_MASK_SOURCES,
  signal: new AbortController().signal,
  ocr: {
    text: async () => {
      ocrCalls.push(now);
      const text = textAt(now);
      if (text === null) throw new Error("tesseract failed");
      return text;
    },
  },
});
const slideAt = (t: number) => slides[Math.min(3, Math.floor(t / 5))]!;

describe("sampleKeyframes counts what it could not capture (B4 review I1, I2)", () => {
  it("counts a failed seek mid-range as missed", async () => {
    frameAt = slideAt;
    const result = await sampleKeyframes(ctx(), player({ seeks: (t) => t !== 8 }), {
      start: 0,
      end: 20,
    });
    expect(result).toMatchObject({ missed: 1, drm: false, unplayable: false });
    expect(result.frames.map((f) => f.segmentStart)).toEqual([0, 6, 10, 16]);
  });

  it("keeps sampling, and counts the misses, while the player has no box", async () => {
    frameAt = slideAt;
    const result = await sampleKeyframes(ctx(), player({ visible: (t) => t < 9 || t > 13 }), {
      start: 0,
      end: 20,
    });
    expect(result.missed).toBe(2);
    expect(result.frames.map((f) => f.segmentStart)).toEqual([0, 6, 14, 16]);
  });

  it("never discards a range for a dark opening", async () => {
    frameAt = (t) => (t < 12 ? black : slideAt(t));
    const result = await sampleKeyframes(ctx(), player(), { start: 0, end: 20 });
    expect(result.drm).toBe(false);
    expect(result.frames.map((f) => f.segmentStart)).toEqual([0, 12, 16]);
  });

  it("calls a range DRM only when every frame is dark", async () => {
    frameAt = () => black;
    expect(await sampleKeyframes(ctx(), player(), { start: 0, end: 20 })).toMatchObject({
      drm: true,
      frames: [],
      sampled: 11,
    });
  });

  it("keeps same-layout slides whose text differs, and merges only matching text (final I5)", async () => {
    // One template for the whole range: the hash says "same" everywhere.
    frameAt = () => new Uint8Array(slides[0]!); // each capture is a fresh buffer
    textAt = (t) =>
      t < 10 ? "The Calvin cycle • Uses ATP and NADPH" : "The Calvin cycle * Needs ATP and NADH";
    const result = await sampleKeyframes(ctx(), player(), { start: 0, end: 20 });
    expect(result.frames.map((f) => f.segmentStart)).toEqual([0, 10]);
    // Bullet glyphs and spacing are OCR noise, not content.
    textAt = (t) => (t % 4 === 0 ? "Uses  ATP • and NADPH" : "uses ATP + and NADPH");
    expect((await sampleKeyframes(ctx(), player(), { start: 0, end: 20 })).frames).toHaveLength(1);
  });

  it("keeps a frame whose text cannot be read (fidelity over dedupe)", async () => {
    frameAt = () => new Uint8Array(slides[0]!); // each capture is a fresh buffer
    textAt = (t) => (t === 8 ? null : "same");
    const result = await sampleKeyframes(ctx(), player(), { start: 0, end: 20 });
    expect(result.frames.length).toBeGreaterThan(1);
  });
});
