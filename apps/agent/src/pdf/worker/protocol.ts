import { z } from "zod";

/** Messages between the agent and the isolated pdf.js worker: PDF bytes in, JSON out (preflight S3). */
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
export interface AnalyzeRequest {
  /** "auto": page 1 at scale 1 (the snapshot) plus every page with images or without text at `scale`. */
  render: "auto" | number[];
  scale: number;
  maxPages: number;
  maxRenders: number;
  maxPixels: number;
}

/** The worker's output is validated like any other untrusted input. */
export const AnalyzeResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    title: z.string().max(1_000).nullable(),
    pages: z.array(
      z.object({
        page: z.number().int().positive(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
        hasImages: z.boolean(),
        items: z.array(
          z.object({
            str: z.string(),
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
            hasEOL: z.boolean(),
          }),
        ),
      }),
    ),
    renders: z.array(
      z.object({
        page: z.number().int().positive(),
        scale: z.number().positive(),
        png: z.string(),
      }),
    ),
  }),
  z.object({ ok: z.literal(false), error: z.enum(["not_pdf", "too_large", "parse_failed"]) }),
]);
export type AnalyzeResult = z.infer<typeof AnalyzeResult>;

export function encodeRequest(request: AnalyzeRequest, pdf: Uint8Array): Buffer {
  const header = Buffer.from(JSON.stringify(request), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length, 0);
  return Buffer.concat([length, header, Buffer.from(pdf)]);
}

export function decodeRequest(buffer: Buffer): { request: AnalyzeRequest; pdf: Uint8Array } {
  const length = buffer.readUInt32BE(0);
  return {
    request: JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")) as AnalyzeRequest,
    pdf: new Uint8Array(buffer.subarray(4 + length)),
  };
}
