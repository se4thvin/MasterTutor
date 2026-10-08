import { createLocalOcr } from "../../browser/local-ocr.ts";

export { ocrContains } from "../../../../../tests/security/canary-core.ts";

export interface Ocr {
  text(png: Buffer): Promise<string>;
  close(): Promise<void>;
}

/** Test-only OCR (spec §12 canary): the agent's own offline tesseract worker. */
export async function createOcr(): Promise<Ocr> {
  return createLocalOcr();
}
