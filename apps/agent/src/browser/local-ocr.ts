import { createRequire } from "node:module";
import path from "node:path";
import sharp from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { abortable } from "../runtime/abortable.ts";
import { containsSecret, type Box, type MaskSources } from "./masking.ts";

/** One OCR'd line: its words in reading order, each with its box in image pixels. */
export interface OcrLine {
  /** `confidence` is tesseract's 0–100 (absent from fakes: read as sure). */
  words: Array<{ text: string; box: Box; confidence?: number }>;
}

/**
 * Self-hosted OCR (tesseract, offline English model): reads pixels without sending them anywhere.
 * An `urgent` read (the agent loop's screenshot screen) always runs before every queued capture
 * read (images, PDF pages, page.png and opaque tiles), so a step never waits behind a long
 * capture (QA-092).
 */
export interface LocalOcr {
  text(png: Uint8Array): Promise<string>;
  words(png: Uint8Array, options?: { urgent?: boolean }): Promise<OcrLine[]>;
}

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface TesseractBlock {
  paragraphs: Array<{ lines: Array<{ words: TesseractWord[] }> }>;
}

/** Waits after a failed worker start before trying again; doubles up to the cap. */
const START_BACKOFF_MS = { first: 1_000, max: 60_000 };

/**
 * One tesseract worker, created on first use; recognitions run one at a time. A start that fails
 * is retried with bounded backoff: until one succeeds every read fails, so callers withhold the
 * pixels (fail closed), and the process never stays without OCR for good.
 */
export function createLocalOcr(): LocalOcr & { close(): Promise<void> } {
  let worker: Promise<Worker> | undefined;
  let backoff = START_BACKOFF_MS.first;
  let retryAt = 0;
  const ready = (): Promise<Worker> => {
    if (worker) return worker;
    if (Date.now() < retryAt) return Promise.reject(new Error("OCR worker failed to start"));
    const started = start();
    worker = started;
    started.then(
      () => {
        backoff = START_BACKOFF_MS.first;
      },
      () => {
        worker = undefined;
        retryAt = Date.now() + backoff;
        backoff = Math.min(backoff * 2, START_BACKOFF_MS.max);
      },
    );
    return started;
  };
  const start = async () => {
    const require = createRequire(import.meta.url);
    const langPath = path.dirname(
      require.resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
    );
    // Worker and core load from the installed package (tesseract.js's Node defaults) and the model
    // from the bundled @tesseract.js-data file: never a CDN. No cache either, so a model file
    // planted in a shared temp directory is never read instead of the bundled one.
    const created = await createWorker("eng", 1, {
      langPath,
      cacheMethod: "none",
      gzip: true,
      logger: () => undefined,
    });
    // Screens are scattered UI text, not one uniform block (tesseract.js's default, PSM 6): in
    // block mode a line inside a bordered field can be dropped entirely.
    await created.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    return created;
  };
  // One recognition at a time; loop screens (`first`) are taken before any queued capture read.
  const first: Array<() => void> = [];
  const later: Array<() => void> = [];
  let busy = false;
  const next = () => {
    const job = first.shift() ?? later.shift();
    busy = job !== undefined;
    job?.();
  };
  const serial = <T>(work: (ready: Worker) => Promise<T>, urgent = false): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      (urgent ? first : later).push(() => {
        ready().then(work).then(resolve, reject).finally(next);
      });
      if (!busy) next();
    });
  return {
    text: (png) => serial(async (ready) => (await ready.recognize(Buffer.from(png))).data.text),
    words: (png, options) =>
      serial(async (ready) => {
        const { data } = await ready.recognize(Buffer.from(png), {}, { blocks: true });
        const blocks = (data.blocks ?? []) as unknown as TesseractBlock[];
        return blocks.flatMap((block) =>
          block.paragraphs.flatMap((paragraph) =>
            paragraph.lines.map((line) => ({
              words: line.words.map((word) => ({
                text: word.text,
                confidence: word.confidence,
                box: {
                  x: word.bbox.x0,
                  y: word.bbox.y0,
                  width: word.bbox.x1 - word.bbox.x0,
                  height: word.bbox.y1 - word.bbox.y0,
                },
              })),
            })),
          ),
        );
      }, options?.urgent ?? false),
    async close() {
      const current = worker;
      worker = undefined;
      if (current) await (await current.catch(() => null))?.terminate();
    },
  };
}

let shared: (LocalOcr & { close(): Promise<void> }) | undefined;

/** The one OCR worker of this process: the agent loop and capture both use it. */
export function sharedLocalOcr(): LocalOcr {
  shared ??= createLocalOcr();
  return shared;
}

/**
 * True when pixels may be stored or sent to OpenAI (CLAUDE.md: secrets never reach the model).
 * Without registered secrets there is nothing to find. With them, local OCR must read the pixels
 * and find no secret; a hit or an OCR failure withholds them (A-M1, A-M2). The run's signal
 * cancels the wait at once (the kill switch never waits for a long read).
 */
/** True while the run has anything the pixel screens look for: secrets, or filled one-time codes. */
export const screensPixels = (secrets: MaskSources) =>
  secrets.hasSecrets() || (secrets.hasOneTimeCodes?.() ?? false);

/** A filled one-time code shows as an exact whole token (edge punctuation aside). */
const isCode = (secrets: MaskSources, word: string) =>
  secrets.isOneTimeCode?.(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")) ?? false;

export async function pixelsAreClean(
  ocr: Pick<LocalOcr, "text">,
  secrets: MaskSources,
  png: Uint8Array,
  signal: AbortSignal,
): Promise<boolean> {
  if (!screensPixels(secrets)) return true;
  let text: string;
  try {
    text = await abortable(ocr.text(png), signal);
  } catch {
    signal.throwIfAborted();
    return false;
  }
  return (
    !containsSecret(secrets, text) &&
    !(secrets.inOcrText?.(text) ?? false) &&
    !text.split(/\s+/).some((word) => isCode(secrets, word))
  );
}

/** page.png tiles: about two viewports each, overlapping so no line of text is cut in two. */
const TILE = { height: 1_600, overlap: 120 };

/**
 * pixelsAreClean over a tall image read in overlapping tiles (QA-092): each tile is its own queued
 * read, so a loop screenshot screen waits for one tile at most, never the whole page.
 */
export async function tallPixelsAreClean(
  ocr: Pick<LocalOcr, "text">,
  secrets: MaskSources,
  png: Uint8Array,
  signal: AbortSignal,
): Promise<boolean> {
  if (!screensPixels(secrets)) return true;
  let height: number;
  let width: number;
  try {
    const meta = await sharp(png).metadata();
    height = meta.height ?? 0;
    width = meta.width ?? 0;
  } catch {
    return false;
  }
  if (height <= TILE.height) return pixelsAreClean(ocr, secrets, png, signal);
  for (let top = 0; top < height; top += TILE.height - TILE.overlap) {
    const tile = await sharp(png)
      .extract({ left: 0, top, width, height: Math.min(TILE.height, height - top) })
      .png()
      .toBuffer();
    if (!(await pixelsAreClean(ocr, secrets, new Uint8Array(tile), signal))) return false;
    if (top + TILE.height >= height) break;
  }
  return true;
}

export type PixelScreen = { kind: "clean" } | { kind: "hit"; boxes: Box[] } | { kind: "failed" };

/** Longest run of OCR words one secret is matched across (a secret OCR split into pieces). */
const MAX_WORDS = 6;

/**
 * Tesseract misses most UI-size text (11–14 px) at 1× and reads it at 2× (QA-098, measured): the
 * image is read once at 1×, then full-width bands are re-read at 2× where that read found small
 * text (median word height under SMALL_LINE_PX), an unsure word, or ink and no word at all.
 */
const OCR_UPSCALE = 2;
const SMALL_LINE_PX = 16;
const SURE_CONFIDENCE = 85;
/** Context kept around a band, and the gap under which two bands merge into one read. */
const BAND_PAD = 6;
const BAND_GAP = 16;
/** A row holds ink when its pixels span at least this much luminance (any colours, any theme). */
const INK_CONTRAST = 40;
/** Ink rows a band needs to be worth a read (a 1 px rule is not text). */
const MIN_INK_ROWS = 4;

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

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Full-width bands to re-read at 2×: small or unsure lines, and ink the 1× read found no word in. */
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
    const small = median(words.map((word) => word.box.height)) < SMALL_LINE_PX;
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

/** Which rows of an image hold ink, and its size. */
async function inkRowsOf(
  png: Uint8Array,
): Promise<{ rows: boolean[]; width: number; height: number }> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rows: boolean[] = [];
  for (let y = 0; y < info.height; y++) {
    let min = 255;
    let max = 0;
    const start = y * info.width * info.channels;
    for (let x = 0; x < info.width; x++) {
      const value = data[start + x * info.channels]!;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    rows.push(max - min >= INK_CONTRAST);
  }
  return { rows, width: info.width, height: info.height };
}

/**
 * Where registered secrets show in an image (I-1): the boxes of the words that hold one, from the
 * 1× read and the 2× bands. The vault registers only secret-class values (passwords, PINs), never
 * usernames or emails. A secret OCR reads across lines, or a read that fails, is `failed`: the
 * caller withholds the image. `urgent` is the agent loop's own screen (QA-092).
 */
export async function screenPixels(
  ocr: LocalOcr,
  secrets: MaskSources,
  png: Uint8Array,
  signal: AbortSignal,
  options: { urgent: boolean } = { urgent: false },
): Promise<PixelScreen> {
  if (!screensPixels(secrets)) return { kind: "clean" };
  const read = async (image: Uint8Array): Promise<OcrLine[] | null> => {
    try {
      return await abortable(ocr.words(image, options), signal);
    } catch {
      signal.throwIfAborted();
      return null;
    }
  };
  let ink: Awaited<ReturnType<typeof inkRowsOf>>;
  try {
    ink = await inkRowsOf(png);
  } catch {
    return { kind: "failed" };
  }
  const lines = await read(png);
  if (lines === null) return { kind: "failed" };
  const native = screenLines(secrets, lines);
  if (native.kind === "failed") return native;
  const boxes = native.kind === "hit" ? [...native.boxes] : [];
  for (const band of closerLookBands(lines, ink, ink.rows)) {
    const large = await sharp(png)
      .extract({ left: band.x, top: band.y, width: band.width, height: band.height })
      .resize(band.width * OCR_UPSCALE, band.height * OCR_UPSCALE, { kernel: "lanczos3" })
      .png()
      .toBuffer();
    const bandLines = await read(new Uint8Array(large));
    if (bandLines === null) return { kind: "failed" };
    const closer = screenLines(secrets, bandLines);
    if (closer.kind === "failed") return closer;
    if (closer.kind === "hit")
      for (const box of closer.boxes)
        boxes.push({
          x: band.x + box.x / OCR_UPSCALE,
          y: band.y + box.y / OCR_UPSCALE,
          width: box.width / OCR_UPSCALE,
          height: box.height / OCR_UPSCALE,
        });
  }
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
