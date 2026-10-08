import sharp from "sharp";
import { abortable } from "../runtime/abortable.ts";
import { isCode, screensPixels, type LocalOcr, type OcrLine } from "./local-ocr.ts";
import { containsSecret, type Box, type MaskSources } from "./masking.ts";
import { pixelKey, type ScreenCache } from "./screen-cache.ts";

export type PixelScreen = { kind: "clean" } | { kind: "hit"; boxes: Box[] } | { kind: "failed" };

/** Longest run of OCR words one secret is matched across (a secret OCR split into pieces). */
const MAX_WORDS = 6;

/**
 * Tesseract misses most UI-size text (11–14 px) at 1× and reads it at 2× (QA-098, measured): a
 * band is read once at 1×, then the parts of it where that read found small text (a line under
 * SMALL_LINE_PX tall, 14 px text and smaller), an unsure word, or ink and no word at all are
 * re-read at 2×.
 */
const OCR_UPSCALE = 2;
const SMALL_LINE_PX = 15;
const SURE_CONFIDENCE = 85;
/** Context kept around a 2× region, and the gap under which two regions merge into one read. */
const BAND_PAD = 6;
const BAND_GAP = 16;
/** A row holds ink when its pixels span at least this much luminance (any colours, any theme). */
const INK_CONTRAST = 40;
/** Ink rows a region needs to be worth a read (a 1 px rule is not text). */
const MIN_INK_ROWS = 4;
/**
 * Line bands are cut where at least this many consecutive rows repeat the row above (blank space,
 * a plain background, a vertical border): the cut depends on content only, so a scrolled band keeps
 * its exact pixels. Larger than any stroke of ordinary text, so no glyph is cut in two.
 */
const SEPARATOR_ROWS = 24;
/**
 * Each OCR call has a fixed cost: past this many new bands, or this share of new rows, one read of
 * the whole frame is cheaper than one read per band.
 */
const MAX_BAND_READS = 4;
/** Blank rows between new bands stacked into one read. */
const STACK_GAP = 24;
const WHOLE_FRAME_SHARE = 0.5;

type Span = readonly [top: number, bottom: number];

function mergeSpans(spans: readonly Span[], height: number): Box[] {
  const merged: Array<[number, number]> = [];
  for (const [top, bottom] of [...spans].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(0, top - BAND_PAD);
    const to = Math.min(height, bottom + BAND_PAD);
    const last = merged.at(-1);
    if (last && from - last[1] <= BAND_GAP) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged
    .filter(([top, bottom]) => bottom > top)
    .map(([top, bottom]) => ({ x: 0, y: top, width: 0, height: bottom - top }));
}

/** Full-width regions to re-read at 2×: small or unsure lines, and ink the 1× read found no word in. */
export function closerLookBands(
  lines: readonly OcrLine[],
  size: { width: number; height: number },
  inkRows: readonly boolean[] = [],
): Box[] {
  const spans: Span[] = [];
  const read = new Array<boolean>(size.height).fill(false);
  for (const { words } of lines) {
    if (words.length === 0) continue;
    const top = Math.min(...words.map((word) => word.box.y));
    const bottom = Math.max(...words.map((word) => word.box.y + word.box.height));
    for (let y = Math.max(0, top - BAND_PAD); y < Math.min(size.height, bottom + BAND_PAD); y++)
      read[y] = true;
    // The line's full height (ascender top to descender bottom) tracks its text size: 11 px text
    // spans ~11 px, 14 px ~13, 16 px body ~16 (measured).
    const small = bottom - top < SMALL_LINE_PX;
    const unsure = words.some((word) => (word.confidence ?? 100) < SURE_CONFIDENCE);
    if (small || unsure) spans.push([top, bottom]);
  }
  for (let y = 0; y < inkRows.length;) {
    let end = y;
    while (end < inkRows.length && inkRows[end] && !read[end]) end++;
    if (end - y >= MIN_INK_ROWS) spans.push([y, end]);
    y = Math.max(end, y + 1);
  }
  return mergeSpans(spans, size.height).map((band) => ({ ...band, width: size.width }));
}

interface Pixels {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
  /** Rows whose pixels span INK_CONTRAST of luminance. */
  ink: boolean[];
  /** Rows byte-identical to the row above. */
  repeats: boolean[];
}

/** The image's exact pixels (RGB, alpha flattened away), its ink rows and its repeated rows. */
async function decode(png: Uint8Array): Promise<Pixels> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rowBytes = info.width * info.channels;
  const ink: boolean[] = [];
  const repeats: boolean[] = [];
  for (let y = 0; y < info.height; y++) {
    let min = 255;
    let max = 0;
    const start = y * rowBytes;
    for (let x = 0; x < info.width; x++) {
      const at = start + x * info.channels;
      const value = (data[at]! * 299 + data[at + 1]! * 587 + data[at + 2]! * 114) / 1000;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    ink.push(max - min >= INK_CONTRAST);
    // The top row has nothing above it: it counts as repeated, so it starts no band by itself.
    repeats.push(
      y === 0 || data.compare(data, start - rowBytes, start, start, start + rowBytes) === 0,
    );
  }
  return { data, width: info.width, height: info.height, channels: info.channels, ink, repeats };
}

/**
 * Horizontal bands of content, full width: runs of rows that change, cut where SEPARATOR_ROWS or
 * more repeated rows lie between them. Each band keeps one repeated row of context on each side.
 */
export function lineBands(repeats: readonly boolean[]): Span[] {
  const bands: Array<[number, number]> = [];
  let y = 0;
  while (y < repeats.length) {
    while (y < repeats.length && repeats[y]) y++;
    if (y >= repeats.length) break;
    const top = y;
    let bottom = y + 1;
    for (let at = bottom; at < repeats.length;) {
      if (!repeats[at]) {
        bottom = at + 1;
        at++;
        continue;
      }
      let run = at;
      while (run < repeats.length && repeats[run]) run++;
      if (run - at >= SEPARATOR_ROWS || run >= repeats.length) break;
      at = run;
    }
    bands.push([Math.max(0, top - 1), Math.min(repeats.length, bottom + 1)]);
    y = bottom;
  }
  return bands;
}

/**
 * What a band's reads found, relative to the band's top: its 1× lines and its 2× lines (scaled to
 * 1×). OCR text of the run's own pages, kept in the run's memory only, never stored.
 */
export interface BandRead {
  lines: OcrLine[];
  closer: OcrLine[];
}

const shift = (lines: readonly OcrLine[], dy: number, scale = 1): OcrLine[] =>
  lines.map((line) => ({
    words: line.words.map((word) => ({
      ...word,
      box: {
        x: word.box.x / scale,
        y: word.box.y / scale + dy,
        width: word.box.width / scale,
        height: word.box.height / scale,
      },
    })),
  }));

/**
 * Where registered secrets show in an image (I-1): the boxes of the words that hold one, from the
 * 1× read and the 2× regions. The vault registers only secret-class values (passwords, PINs), never
 * usernames or emails. A secret OCR reads across lines, or a read that fails, is `failed`: the
 * caller withholds the image. `urgent` is the agent loop's own screen (QA-092).
 *
 * With the run's `cache`, the image is cut into content-defined line bands; a band whose exact
 * pixels (SHA-256) were read under the current secret set reuses that read wherever it now sits,
 * so a scrolled frame reads only its new or changed bands. Failed reads are never cached. Matching
 * always runs on the whole frame's words, at their current positions.
 */
export async function screenPixels(
  ocr: LocalOcr,
  secrets: MaskSources,
  png: Uint8Array,
  signal: AbortSignal,
  options: { urgent: boolean; cache?: ScreenCache<BandRead> } = { urgent: false },
): Promise<PixelScreen> {
  if (!screensPixels(secrets)) return { kind: "clean" };
  const { cache } = options;
  const read = async (image: Uint8Array): Promise<OcrLine[] | null> => {
    try {
      return await abortable(ocr.words(image, { urgent: options.urgent }), signal);
    } catch {
      signal.throwIfAborted();
      return null;
    }
  };
  let pixels: Pixels;
  try {
    pixels = await decode(png);
  } catch {
    return { kind: "failed" };
  }
  const rowBytes = pixels.width * pixels.channels;
  const crop = (top: number, height: number, scale: number) =>
    sharp(png)
      .extract({ left: 0, top, width: pixels.width, height })
      .resize(pixels.width * scale, height * scale, { kernel: "lanczos3" })
      .png()
      .toBuffer()
      .then((buffer) => new Uint8Array(buffer));
  // Without a cache the frame is one band: one read, as before.
  const bands: Span[] = cache ? lineBands(pixels.repeats) : [[0, pixels.height]];
  const keys = bands.map(([top, bottom]) =>
    cache
      ? pixelKey(
          "band",
          { ...pixels, height: bottom - top },
          pixels.data.subarray(top * rowBytes, bottom * rowBytes),
        )
      : "",
  );
  const reads: Array<BandRead | undefined> = keys.map((key) => cache?.get(secrets, key));
  const missing = bands.flatMap((_, i) => (reads[i] ? [] : [i]));
  const missingRows = missing.reduce((sum, i) => sum + bands[i]![1] - bands[i]![0], 0);
  // 1×: one read of the whole frame when most of it is new, else one read per new band.
  const fresh = new Map<number, OcrLine[]>();
  if (
    missing.length > MAX_BAND_READS ||
    (missing.length > 0 && missingRows > pixels.height * WHOLE_FRAME_SHARE)
  ) {
    const lines = await read(png);
    if (lines === null) return { kind: "failed" };
    for (const i of missing) fresh.set(i, []);
    const distance = (i: number, y: number) =>
      y < bands[i]![0] ? bands[i]![0] - y : y >= bands[i]![1] ? y - bands[i]![1] + 1 : 0;
    for (const line of lines) {
      if (line.words.length === 0) continue;
      const top = Math.min(...line.words.map((word) => word.box.y));
      const bottom = Math.max(...line.words.map((word) => word.box.y + word.box.height));
      const middle = (top + bottom) / 2;
      const at = bands.findIndex((_, i) => distance(i, middle) === 0);
      // A cached band already holds its own read; a line outside every band joins the nearest new one.
      if (at >= 0 && !fresh.has(at)) continue;
      const owner =
        at >= 0
          ? at
          : missing.reduce((best, i) => (distance(i, middle) < distance(best, middle) ? i : best));
      fresh.get(owner)!.push(...shift([line], -bands[owner]![0]));
    }
  } else if (missing.length > 0) {
    // The new bands stacked in one image (blank rows between them): one OCR call, not one each.
    const offsets: number[] = [];
    let height = 0;
    for (const i of missing) {
      offsets.push(height);
      height += bands[i]![1] - bands[i]![0] + STACK_GAP;
    }
    const stacked = new Uint8Array(
      await sharp({
        create: { width: pixels.width, height, channels: 3, background: "#ffffff" },
      })
        .composite(
          await Promise.all(
            missing.map(async (i, k) => ({
              input: Buffer.from(await crop(bands[i]![0], bands[i]![1] - bands[i]![0], 1)),
              left: 0,
              top: offsets[k]!,
            })),
          ),
        )
        .withMetadata({ density: 72 })
        .png()
        .toBuffer(),
    );
    const lines = await read(stacked);
    if (lines === null) return { kind: "failed" };
    for (const i of missing) fresh.set(i, []);
    for (const line of lines) {
      if (line.words.length === 0) continue;
      const top = Math.min(...line.words.map((word) => word.box.y));
      const k = offsets.findLastIndex((offset) => offset <= top);
      if (k < 0) continue;
      fresh.get(missing[k]!)!.push(...shift([line], -offsets[k]!));
    }
  }
  // 2×: small, unsure or unread ink parts of each new band.
  for (const i of missing) {
    const [top, bottom] = bands[i]!;
    const lines = fresh.get(i) ?? [];
    const closer: OcrLine[] = [];
    const regions = closerLookBands(
      lines,
      { width: pixels.width, height: bottom - top },
      pixels.ink.slice(top, bottom),
    );
    for (const region of regions) {
      const large = await read(await crop(top + region.y, region.height, OCR_UPSCALE));
      if (large === null) return { kind: "failed" };
      closer.push(...shift(shift(large, 0, OCR_UPSCALE), region.y));
    }
    reads[i] = { lines, closer };
    cache?.set(secrets, keys[i]!, reads[i]);
  }
  // Match on the whole frame's words at their current positions.
  const placed = (pick: (band: BandRead) => OcrLine[]) =>
    bands.flatMap(([top], i) => shift(pick(reads[i]!), top));
  const native = screenLines(
    secrets,
    placed((band) => band.lines),
  );
  if (native.kind === "failed") return native;
  const closer = screenLines(
    secrets,
    placed((band) => band.closer),
  );
  if (closer.kind === "failed") return closer;
  const boxes = [
    ...(native.kind === "hit" ? native.boxes : []),
    ...(closer.kind === "hit" ? closer.boxes : []),
  ];
  return boxes.length > 0 ? { kind: "hit", boxes } : { kind: "clean" };
}

/** Where registered secrets show in lines already read (screenPixels without the read). */
export function screenLines(secrets: MaskSources, lines: readonly OcrLine[]): PixelScreen {
  const boxes: Box[] = [];
  const exact = (words: OcrLine["words"]) =>
    containsSecret(secrets, words.map((word) => word.text).join(" ")) ||
    containsSecret(secrets, words.map((word) => word.text).join(""));
  // A misread secret (O for 0, l for 1…) matches only through the vault's folded form (QA-099).
  const folded = (words: OcrLine["words"]) =>
    secrets.inOcrText?.(words.map((word) => word.text).join(" ")) ?? false;
  const holds = (words: OcrLine["words"]) => exact(words) || folded(words);
  for (const { words } of lines) {
    // Folded matching scans the whole text: only lines that hold a folded secret pay for windows.
    const lineFolded = folded(words);
    const inLine = (window: OcrLine["words"]) => exact(window) || (lineFolded && folded(window));
    for (const word of words) if (isCode(secrets, word.text)) boxes.push(word.box);
    // The shortest window ending at each word: growing backwards from `end` finds the words
    // that hold the secret and no neighbours ("pw" before a password stays readable).
    let from = 0;
    for (let end = 0; end < words.length; end++) {
      for (let start = end; start >= Math.max(from, end - MAX_WORDS + 1); start--) {
        const window = words.slice(start, end + 1);
        if (!inLine(window)) continue;
        boxes.push(...window.map((word) => word.box));
        from = end + 1;
        break;
      }
    }
  }
  if (boxes.length > 0) return { kind: "hit", boxes };
  // A secret only the whole text holds (split across lines) has no box to fill.
  const all = lines.flatMap((line) => line.words);
  return holds(all) ? { kind: "failed" } : { kind: "clean" };
}
