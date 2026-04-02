import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createWorker } from "tesseract.js";

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
  return {
    text: async (png) => (await worker.recognize(png)).data.text,
    close: async () => {
      await worker.terminate();
    },
  };
}

/** Characters OCR confuses, folded to one form on both sides of a comparison. */
const CONFUSABLE: Record<string, string> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  "|": "1",
  Z: "2",
  S: "5",
  B: "8",
  G: "6",
  T: "7",
};

function fold(text: string): string {
  return Array.from(
    text.toUpperCase().replace(/[^A-Z0-9|]/g, ""),
    (char) => CONFUSABLE[char] ?? char,
  ).join("");
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** True when OCR text contains the canary up to confusable characters and 2 edits. */
export function ocrContains(ocrText: string, canary: string): boolean {
  const hay = fold(ocrText);
  const needle = fold(canary);
  if (hay.includes(needle)) return true;
  for (let i = 0; i + needle.length - 2 <= hay.length; i++) {
    if (distance(hay.slice(i, i + needle.length), needle) <= 2) return true;
  }
  return false;
}
