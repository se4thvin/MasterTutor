import { createRequire } from "node:module";
import path from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { abortable } from "../runtime/abortable.ts";
import { containsSecret, type Box, type MaskSources } from "./masking.ts";

/** One OCR'd line: its words in reading order, each with its box in image pixels. */
export interface OcrLine {
  words: Array<{ text: string; box: Box }>;
}

/** Self-hosted OCR (tesseract, offline English model): reads pixels without sending them anywhere. */
export interface LocalOcr {
  text(png: Uint8Array): Promise<string>;
  words(png: Uint8Array): Promise<OcrLine[]>;
}

interface TesseractWord {
  text: string;
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
  let queue: Promise<unknown> = Promise.resolve();
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
  const serial = <T>(work: (ready: Worker) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => work(await ready()));
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    text: (png) => serial(async (ready) => (await ready.recognize(Buffer.from(png))).data.text),
    words: (png) =>
      serial(async (ready) => {
        const { data } = await ready.recognize(Buffer.from(png), {}, { blocks: true });
        const blocks = (data.blocks ?? []) as unknown as TesseractBlock[];
        return blocks.flatMap((block) =>
          block.paragraphs.flatMap((paragraph) =>
            paragraph.lines.map((line) => ({
              words: line.words.map((word) => ({
                text: word.text,
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
      }),
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

export type PixelScreen = { kind: "clean" } | { kind: "hit"; boxes: Box[] } | { kind: "failed" };

/** Longest run of OCR words one secret is matched across (a secret OCR split into pieces). */
const MAX_WORDS = 6;

/**
 * Where registered secrets show in an image (I-1): the boxes of the words that hold one. The
 * vault registers only secret-class values (passwords, PINs), never usernames or emails, so a
 * page showing the account's email is left as it is. A secret OCR reads across lines, or a read
 * that fails, is `failed`: the caller withholds the image.
 */
export async function screenPixels(
  ocr: LocalOcr,
  secrets: MaskSources,
  png: Uint8Array,
  signal: AbortSignal,
): Promise<PixelScreen> {
  if (!screensPixels(secrets)) return { kind: "clean" };
  let lines: OcrLine[];
  try {
    lines = await abortable(ocr.words(png), signal);
  } catch {
    signal.throwIfAborted();
    return { kind: "failed" };
  }
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
