import type { BlockOrigin } from "@mastertutor/contracts";
import { pixelsAreClean, type LocalOcr } from "../browser/local-ocr.ts";
import type { MaskSources } from "../browser/masking.ts";
import type { AssetStore } from "../notes/assets.ts";
import { screenText, type BlockDraft } from "../notes/note-writer.ts";
import type { Log } from "../runtime/types.ts";
import type { StepWriter } from "../tools/types.ts";
import { limitBlockSize, splitMarkdown } from "./markdown-blocks.ts";
import type { OcrModel } from "./opaque.ts";

export interface RegionReader {
  assets: AssetStore;
  ocr: OcrModel;
  localOcr: Pick<LocalOcr, "text">;
  log: Log;
}

export interface RegionContext {
  workspaceId: string;
  signal: AbortSignal;
  step: StepWriter;
  mask: MaskSources;
}

export interface Region {
  png: Uint8Array;
  width: number | null;
  height: number | null;
  /** The image block's caption, e.g. "Page 3" or "Page region 2". */
  label: string;
  /** Where the pixels came from: "dom" for a page region, "pdf" for a PDF page. */
  imageOrigin: BlockOrigin;
  anchor: BlockDraft["anchor"];
  /** The pixels already passed the local secret screen (PDF renders are screened as they arrive). */
  screened?: boolean;
}

/**
 * One region of pixels whose text only OCR can read (spec §7.7; web canvas tiles and textless PDF
 * pages share it, final review I2). In order: the local secret screen, then OCR (budget-checked per
 * call), then a screen of what OCR read, and only then is the image stored. `lost` is true when
 * the note does not hold the region's text: withheld pixels, an OCR failure or budget stop, or an
 * empty read. A lost region is never `verified` content.
 */
export async function readRegion(
  deps: RegionReader,
  ctx: RegionContext,
  region: Region,
): Promise<{ blocks: BlockDraft[]; lost: boolean }> {
  // Pixels reach OpenAI only after a local secret screen passes (A-M1).
  if (!region.screened && !(await pixelsAreClean(deps.localOcr, ctx.mask, region.png, ctx.signal)))
    return { blocks: [], lost: true };
  let text: string | null;
  try {
    text = (await deps.ocr.transcribe(region.png, { signal: ctx.signal, step: ctx.step })).trim();
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    // A model error or a spent budget loses this region's text, not the capture (M6, I6).
    deps.log.warn({ errName: (error as Error).name }, "OCR failed for a region");
    text = null;
  }
  if (text !== null) screenText(ctx.mask, text);
  // Unread pixels are never stored while the run holds secrets (re-review I1).
  if (text === null && ctx.mask.hasSecrets()) return { blocks: [], lost: true };
  const { assetId } = await deps.assets.put(
    ctx.workspaceId,
    {
      bytes: region.png,
      mime: "image/png",
      width: region.width,
      height: region.height,
      sourceUrl: null,
    },
    ctx.mask,
  );
  const image: BlockDraft = {
    type: "image",
    markdown: region.label,
    origin: region.imageOrigin,
    assetId,
    anchor: region.anchor,
    verified: true,
  };
  // A region that shows something but reads as no text is missing text (B5 I-4).
  if (!text) return { blocks: [image], lost: true };
  // Headings, lists and paragraphs stay separate blocks, each within the size limit (M4).
  const read = splitMarkdown(text)
    .flatMap((block) => limitBlockSize(block))
    .map((part): BlockDraft => ({
      ...part,
      origin: "ocr_model",
      assetId: null,
      anchor: region.anchor,
      verified: false,
    }));
  return { blocks: [image, ...read], lost: false };
}
