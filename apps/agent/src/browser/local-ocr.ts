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

/** True while the run has anything the pixel screens look for: secrets, or filled one-time codes. */
export const screensPixels = (secrets: MaskSources) =>
  secrets.hasSecrets() || (secrets.hasOneTimeCodes?.() ?? false);

/** A filled one-time code shows as an exact whole token (edge punctuation aside). */
export const isCode = (secrets: MaskSources, word: string) =>
  secrets.isOneTimeCode?.(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")) ?? false;

/**
 * True when pixels may be stored or sent to OpenAI (CLAUDE.md: secrets never reach the model).
 * Without registered secrets there is nothing to find. With them, local OCR must read the pixels
 * and find no secret; a hit or an OCR failure withholds them (A-M1, A-M2). The run's signal
 * cancels the wait at once (the kill switch never waits for a long read).
 */
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
