import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createWorker, PSM } from "tesseract.js";

export { ocrContains } from "../../../../../tests/security/canary-core.ts";

export interface Ocr {
  text(png: Buffer): Promise<string>;
  close(): Promise<void>;
}

/** Test-only OCR (spec §12 canary), fully offline from the bundled English model. */
export async function createOcr(): Promise<Ocr> {
  const require = createRequire(import.meta.url);
  const langPath = path.dirname(
    require.resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
  );
  const worker = await createWorker("eng", 1, {
    langPath,
    cachePath: os.tmpdir(),
    gzip: true,
    logger: () => undefined,
  });
  // A screenshot is scattered UI text, not one uniform block (tesseract.js's default, PSM 6).
  // In block mode a line inside a bordered field can be dropped entirely: with Linux's DejaVu
  // rendering the filled email field was never read, so OCR could not see what it must catch.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  return {
    text: async (png) => (await worker.recognize(png)).data.text,
    close: async () => {
      await worker.terminate();
    },
  };
}
