import { z } from "zod";
import {
  MAX_PAGE_ITEMS,
  MAX_PDF_PAGES,
  MAX_PDF_RENDERS,
  type AnalyzeOptions,
} from "../protocol.ts";

/**
 * The pdf-worker service ↔ its `node --permission` child (defence in depth inside the container):
 * the same request body in, this JSON out on stdout.
 */
export interface ChildLimits {
  maxPages: number;
  maxRenders: number;
  maxPixels: number;
  maxImagePixels: number;
  maxPageItems: number;
  maxTextChars: number;
}
export type ChildRequest = AnalyzeOptions & ChildLimits;

/** The child's output is validated like any other untrusted input. */
export const ChildResult = z.discriminatedUnion("ok", [
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
          items: z
            .array(
              z.object({
                str: z.string(),
                x: z.number(),
                y: z.number(),
                width: z.number(),
                height: z.number(),
                hasEOL: z.boolean(),
              }),
            )
            .max(MAX_PAGE_ITEMS),
        }),
      )
      .max(MAX_PDF_PAGES),
    renders: z
      .array(
        z.object({
          page: z.number().int().positive(),
          scale: z.number().positive(),
          png: z.string(),
        }),
      )
      .max(MAX_PDF_RENDERS),
  }),
  z.object({ ok: z.literal(false), error: z.enum(["not_pdf", "too_large", "parse_failed"]) }),
]);
export type ChildResult = z.infer<typeof ChildResult>;

export function encodeChildRequest(request: ChildRequest, pdf: Uint8Array): Buffer {
  const header = Buffer.from(JSON.stringify(request), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length, 0);
  return Buffer.concat([length, header, Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength)]);
}

export function decodeChildRequest(buffer: Buffer): { request: ChildRequest; pdf: Uint8Array } {
  const length = buffer.readUInt32BE(0);
  return {
    request: JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")) as ChildRequest,
    pdf: new Uint8Array(buffer.subarray(4 + length)),
  };
}
