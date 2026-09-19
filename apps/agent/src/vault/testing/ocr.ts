import { createLocalOcr } from "../../browser/local-ocr.ts";
import { foldConfusables as fold } from "../confusables.ts";

export interface Ocr {
  text(png: Buffer): Promise<string>;
  close(): Promise<void>;
}

/** Test-only OCR (spec §12 canary): the agent's own offline tesseract worker. */
export async function createOcr(): Promise<Ocr> {
  return createLocalOcr();
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
