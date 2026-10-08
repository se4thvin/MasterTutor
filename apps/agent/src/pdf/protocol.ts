import { z } from "zod";

/**
 * The agent ↔ `pdf-worker` service contract (B5 review I-1): PDF bytes in, schema-checked and
 * size-capped JSON out. The service parses with pdf.js in its own container; the agent only reads
 * this answer, so no PDF parser ever runs where the vault key lives.
 */

export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;
export const MAX_PDF_RENDERS = 40;
/** US Letter at scale 2 (1224×1584) fits; larger pages are scaled down. */
export const MAX_RENDER_PIXELS = 4_000_000;
/** pdf.js decodes no image larger than this (I-2: a 50k×50k XObject is refused, not allocated). */
export const MAX_IMAGE_PIXELS = 16_000_000;
/** Text items per page and per document, characters per document (I-3: bound layout and the answer). */
export const MAX_PAGE_ITEMS = 100_000;
export const MAX_DOCUMENT_ITEMS = 500_000;
export const MAX_TEXT_CHARS = 10_000_000;
/** Blocks per document, as for docling (re-review N-1); past it the note is partial and says so. */
export const MAX_PDF_BLOCKS = 20_000;
/** Page renders per document, in PNG bytes: past it pages go without a render (counted missing). */
export const MAX_RENDER_BYTES = 64 * 1024 * 1024;
/** One PDF's parse and renders; the worker is killed at this point. */
export const WORKER_TIMEOUT_MS = 120_000;
/** The answer's size, checked by the service and again by the agent while reading. */
export const MAX_RESULT_BYTES = 128 * 1024 * 1024;

export interface AnalyzeOptions {
  /** "auto": page 1 at scale 1 (the snapshot) plus every page with images or without text at `scale`. */
  render: "auto" | number[];
  scale: number;
}

export const AnalyzeOptionsSchema = z.object({
  render: z.union([z.literal("auto"), z.array(z.number().int().positive()).max(MAX_PDF_PAGES)]),
  scale: z.number().positive().max(10),
});

/** The request body: a 4-byte header length, the JSON options, then the PDF bytes. */
export function encodeRequest(options: AnalyzeOptions, pdf: Uint8Array): Buffer {
  const header = Buffer.from(JSON.stringify(options), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length, 0);
  return Buffer.concat([length, header, Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength)]);
}

export function decodeRequest(buffer: Buffer): { options: AnalyzeOptions; pdf: Uint8Array } | null {
  if (buffer.length < 4) return null;
  const length = buffer.readUInt32BE(0);
  if (length > 64 * 1024 || 4 + length > buffer.length) return null;
  let header: unknown;
  try {
    header = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
  } catch {
    return null;
  }
  const options = AnalyzeOptionsSchema.safeParse(header);
  if (!options.success) return null;
  // A view, not a copy (re-review N-2): the body is held once.
  return { options: options.data, pdf: buffer.subarray(4 + length) };
}

/** One pdf.js text item, in PDF points with a top-left origin. */
export interface PdfTextItem {
  str: string;
  x: number;
  /** Top of the glyph box, PDF points from the page top. */
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}
export interface PdfPageText {
  page: number;
  width: number;
  height: number;
  items: PdfTextItem[];
  hasImages: boolean;
}

const Box = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const PdfAnswer = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    title: z.string().max(1_000).nullable(),
    pages: z
      .array(
        z.object({
          page: z.number().int().positive(),
          width: z.number().nonnegative(),
          height: z.number().nonnegative(),
          hasImages: z.boolean(),
          hasText: z.boolean(),
        }),
      )
      .max(MAX_PDF_PAGES),
    /** Every pdf.js text item, in order: the verification reference (spec §7.6). */
    reference: z.string().max(MAX_TEXT_CHARS + MAX_DOCUMENT_ITEMS + MAX_PDF_PAGES),
    /** The layout gave more than MAX_PDF_BLOCKS blocks; only the first ones are here. */
    truncated: z.boolean(),
    blocks: z
      .array(
        z.object({
          type: z.enum(["heading", "paragraph", "list"]),
          markdown: z.string(),
          page: z.number().int().positive(),
          bbox: Box,
        }),
      )
      .max(MAX_PDF_BLOCKS),
    renders: z
      .array(
        z.object({
          page: z.number().int().positive(),
          scale: z.number().positive(),
          png: z.base64(),
        }),
      )
      .max(MAX_PDF_RENDERS),
  }),
  z.object({
    ok: z.literal(false),
    error: z.enum(["not_pdf", "too_large", "parse_failed", "worker_failed", "busy"]),
  }),
]);
export type PdfAnswer = z.infer<typeof PdfAnswer>;
