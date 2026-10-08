import { readCappedText } from "../runtime/read-capped.ts";
import {
  encodeRequest,
  MAX_PDF_BYTES,
  MAX_RESULT_BYTES,
  PdfAnswer,
  WORKER_TIMEOUT_MS,
  type AnalyzeOptions,
} from "./protocol.ts";

export interface PdfRender {
  page: number;
  scale: number;
  png: Uint8Array;
}
export interface PdfBlock {
  type: "heading" | "paragraph" | "list";
  markdown: string;
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
}
export interface PdfPageInfo {
  page: number;
  width: number;
  height: number;
  hasImages: boolean;
  hasText: boolean;
}
export interface PdfAnalysis {
  title: string | null;
  pages: PdfPageInfo[];
  /** Every pdf.js text item, in order (spec §7.6). */
  reference: string;
  blocks: PdfBlock[];
  renders: PdfRender[];
}

export type PdfWorkerErrorCode = "not_pdf" | "too_large" | "parse_failed" | "worker_failed";
export class PdfWorkerError extends Error {
  readonly code: PdfWorkerErrorCode;
  constructor(code: PdfWorkerErrorCode) {
    super(`pdf worker: ${code}`);
    this.name = "PdfWorkerError";
    this.code = code;
  }
}

/** Where PDFs are parsed: the pdf-worker service, never this process (B5 review I-1). */
export interface PdfAnalyzer {
  analyze(bytes: Uint8Array, options: AnalyzeOptions, signal: AbortSignal): Promise<PdfAnalysis>;
}

/** Room for a full queue ahead of this PDF in the worker (2 running, 4 waiting) plus its own parse. */
const REQUEST_TIMEOUT_MS = 3 * WORKER_TIMEOUT_MS + 10_000;

/**
 * The agent's side of the pdf-worker contract: PDF bytes out, a size-capped answer in, validated
 * with the shared schema before anything reads it. `baseUrl` is the internal service address from
 * env, never a page URL.
 */
export function createPdfWorkerClient(baseUrl: string): PdfAnalyzer {
  return {
    async analyze(bytes, options, signal) {
      signal.throwIfAborted();
      if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfWorkerError("too_large");
      let text: string;
      try {
        const response = await fetch(new URL("/analyze", baseUrl), {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: new Uint8Array(encodeRequest(options, bytes)),
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        text = await readCappedText(response.body, MAX_RESULT_BYTES);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof PdfWorkerError) throw error;
        throw new PdfWorkerError("worker_failed");
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new PdfWorkerError("worker_failed");
      }
      const parsed = PdfAnswer.safeParse(json);
      if (!parsed.success) throw new PdfWorkerError("worker_failed");
      const answer = parsed.data;
      if (!answer.ok)
        throw new PdfWorkerError(answer.error === "busy" ? "worker_failed" : answer.error);
      return {
        title: answer.title,
        pages: answer.pages,
        reference: answer.reference,
        blocks: answer.blocks,
        renders: answer.renders.map((r) => ({
          page: r.page,
          scale: r.scale,
          png: new Uint8Array(Buffer.from(r.png, "base64")),
        })),
      };
    },
  };
}
