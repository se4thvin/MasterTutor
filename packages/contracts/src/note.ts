import { z } from "zod";
import { BlockOrigin, BlockType } from "./enums.ts";
import { MAX_BLOCK_CHARS } from "./markdown.ts";
import { IsoDateTime, Sha256Hex, Uuid } from "./primitives.ts";

export const BBox = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type BBox = z.infer<typeof BBox>;

const Offset = z.number().int().nonnegative().nullable();
const Seconds = z.number().nonnegative();

/** Provenance anchor (spec §4): DOM fields, plus page/bbox for PDFs, plus tStart/tEnd for video. */
export const Anchor = z
  .object({
    selector: z.string().max(2000).nullable(),
    xpath: z.string().max(2000).nullable(),
    /** Child-node path from the document, used to order overlapping DOM captures. */
    domOrder: z.array(z.number().int().nonnegative()).max(256).optional(),
    start: Offset,
    end: Offset,
    textFragment: z.string().max(2000).nullable(),
    page: z.number().int().positive().optional(),
    bbox: BBox.optional(),
    tStart: Seconds.optional(),
    tEnd: Seconds.optional(),
  })
  .refine((a) => a.start === null || a.end === null || a.end >= a.start, {
    message: "end must be >= start",
    path: ["end"],
  })
  .refine((a) => a.tStart === undefined || a.tEnd === undefined || a.tEnd >= a.tStart, {
    message: "tEnd must be >= tStart",
    path: ["tEnd"],
  });
export type Anchor = z.infer<typeof Anchor>;

export const NoteBlock = z.object({
  id: Uuid,
  noteId: Uuid,
  position: z.string().min(1).max(256),
  type: BlockType,
  markdown: z.string().max(MAX_BLOCK_CHARS),
  assetId: Uuid.nullable(),
  sourceId: Uuid.nullable(),
  origin: BlockOrigin,
  anchor: Anchor.nullable(),
  contentSha256: Sha256Hex.nullable(),
  verified: z.boolean(),
  edited: z.boolean(),
  originalMarkdown: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type NoteBlock = z.infer<typeof NoteBlock>;
