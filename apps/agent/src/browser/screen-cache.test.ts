import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { screenPixels, type CachedScreen, type LocalOcr } from "./local-ocr.ts";
import type { MaskSources } from "./masking.ts";
import { createScreenCache } from "./screen-cache.ts";

const signal = new AbortController().signal;

/** 400×200 white, with a dark bar (ink) in rows 20–29 and optionally one changed pixel. */
async function frame(changed?: { x: number; y: number }) {
  const { data, info } = await sharp({
    create: { width: 400, height: 200, channels: 3, background: "#fff" },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 20; y < 30; y++)
    for (let x = 10; x < 300; x++) data.fill(0, (y * 400 + x) * 3, (y * 400 + x) * 3 + 3);
  if (changed)
    data.fill(90, (changed.y * 400 + changed.x) * 3, (changed.y * 400 + changed.x) * 3 + 3);
  return new Uint8Array(await sharp(data, { raw: info }).png().toBuffer());
}

/** A fake reader that counts reads: one small, sure line over the bar (so the bar gets a 2× band). */
function countingOcr() {
  const ocr: LocalOcr & { reads: number } = {
    reads: 0,
    text: async () => "",
    words: async () => {
      ocr.reads++;
      return [
        {
          words: [
            { text: "Quarterly", confidence: 95, box: { x: 10, y: 20, width: 290, height: 10 } },
          ],
        },
      ];
    },
  };
  return ocr;
}

function vault(): MaskSources & { bump(): void } {
  let version = 0;
  return {
    nodeIds: () => [],
    hasSecrets: () => true,
    redact: (text) => text.replaceAll("hunter2", "[secret]"),
    secretsVersion: () => version,
    bump: () => void version++,
  };
}

describe("the per-run pixel-screen cache (QA-098 ruling)", () => {
  it("reuses the screen of an unchanged frame: no OCR at all", async () => {
    const ocr = countingOcr();
    const sources = vault();
    const cache = createScreenCache<CachedScreen>(sources);
    const png = await frame();
    expect(await screenPixels(ocr, sources, png, signal, { urgent: true, cache })).toEqual({
      kind: "clean",
    });
    expect(ocr.reads).toBe(2); // the 1× frame and its 2× band
    await screenPixels(ocr, sources, png, signal, { urgent: true, cache });
    expect(ocr.reads).toBe(2);
  });
  it("re-screens what changed: a pixel outside the band re-reads the frame, not the band", async () => {
    const ocr = countingOcr();
    const sources = vault();
    const cache = createScreenCache<CachedScreen>(sources);
    await screenPixels(ocr, sources, await frame(), signal, { urgent: true, cache });
    await screenPixels(ocr, sources, await frame({ x: 5, y: 150 }), signal, {
      urgent: true,
      cache,
    });
    expect(ocr.reads).toBe(3);
    // A pixel inside the band changes the band too.
    await screenPixels(ocr, sources, await frame({ x: 50, y: 25 }), signal, {
      urgent: true,
      cache,
    });
    expect(ocr.reads).toBe(5);
  });
  it("drops every result when the secret set changes (a new secret or one-time code)", async () => {
    const ocr = countingOcr();
    const sources = vault();
    const cache = createScreenCache<CachedScreen>(sources);
    const png = await frame();
    await screenPixels(ocr, sources, png, signal, { urgent: true, cache });
    sources.bump();
    await screenPixels(ocr, sources, png, signal, { urgent: true, cache });
    expect(ocr.reads).toBe(4);
  });
  it("serves no other run: another run's sources neither read nor fill it", async () => {
    const ocr = countingOcr();
    const mine = vault();
    const theirs = vault();
    const cache = createScreenCache<CachedScreen>(mine);
    const png = await frame();
    await screenPixels(ocr, mine, png, signal, { urgent: true, cache });
    await screenPixels(ocr, theirs, png, signal, { urgent: true, cache });
    await screenPixels(ocr, theirs, png, signal, { urgent: true, cache });
    expect(ocr.reads).toBe(6);
    expect(cache.get(theirs, "anything")).toBeUndefined();
  });
  it("never caches a failed read, and caches nothing without a secret-set version", async () => {
    const sources = vault();
    const cache = createScreenCache<CachedScreen>(sources);
    let reads = 0;
    const failing: LocalOcr = {
      text: async () => "",
      words: async () => {
        reads++;
        throw new Error("tesseract crashed");
      },
    };
    const png = await frame();
    expect(await screenPixels(failing, sources, png, signal, { urgent: true, cache })).toEqual({
      kind: "failed",
    });
    await screenPixels(failing, sources, png, signal, { urgent: true, cache });
    expect(reads).toBe(2);
    const ocr = countingOcr();
    const unversioned = { ...vault(), secretsVersion: undefined };
    const plain = createScreenCache<CachedScreen>(unversioned);
    await screenPixels(ocr, unversioned, png, signal, { urgent: true, cache: plain });
    await screenPixels(ocr, unversioned, png, signal, { urgent: true, cache: plain });
    expect(ocr.reads).toBe(4);
  });
  it("is bounded: the least recently used entry goes first", () => {
    const sources = vault();
    const cache = createScreenCache<number>(sources, 2);
    cache.set(sources, "a", 1);
    cache.set(sources, "b", 2);
    cache.get(sources, "a");
    cache.set(sources, "c", 3);
    expect([cache.get(sources, "a"), cache.get(sources, "b"), cache.get(sources, "c")]).toEqual([
      1,
      undefined,
      3,
    ]);
  });
});
