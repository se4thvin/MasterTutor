import { createRequire } from "node:module";
import path from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { containsSecret, type MaskSources } from "../browser/masking.ts";

/** Self-hosted OCR (tesseract, offline English model): reads pixels without sending them anywhere. */
export interface LocalOcr {
  text(png: Uint8Array): Promise<string>;
}

/** One tesseract worker per process, created on first use; recognitions run one at a time. */
export function createLocalOcr(): LocalOcr & { close(): Promise<void> } {
  let worker: Promise<Worker> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
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
  return {
    text(png) {
      const run = queue.then(async () => {
        worker ??= start();
        return (await (await worker).recognize(Buffer.from(png))).data.text;
      });
      queue = run.catch(() => undefined);
      return run;
    },
    async close() {
      if (worker) await (await worker).terminate();
    },
  };
}

/**
 * True when pixels may be stored or sent to OpenAI (CLAUDE.md: secrets never reach the model).
 * Without registered secrets there is nothing to find. With them, local OCR must read the pixels
 * and find no secret; a hit or an OCR failure withholds them (A-M1, A-M2).
 */
export async function pixelsAreClean(
  ocr: LocalOcr,
  secrets: MaskSources,
  png: Uint8Array,
  signal: AbortSignal,
): Promise<boolean> {
  if (!secrets.hasSecrets()) return true;
  let text: string;
  try {
    text = await ocr.text(png);
  } catch {
    signal.throwIfAborted();
    return false;
  }
  signal.throwIfAborted();
  return !containsSecret(secrets, text);
}
