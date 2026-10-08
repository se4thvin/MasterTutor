import { escapeMarkdownText, VERIFIED_COVERAGE, type BBox } from "@mastertutor/contracts";
import sharp from "sharp";
import { fetchInBrowser } from "../capture/fetch-resource.ts";
import { pixelsAreClean, type LocalOcr } from "../browser/local-ocr.ts";
import { blockPlainText, limitBlockSize, splitMarkdown } from "../capture/markdown-blocks.ts";
import type { OcrModel } from "../capture/opaque.ts";
import { coverageOf, precisionAgainst } from "../capture/text.ts";
import { AssetRejected, type AssetStore } from "../notes/assets.ts";
import { sha256Hex } from "../notes/hash.ts";
import { NoteWriteError, screenText, screenValue, type BlockDraft } from "../notes/note-writer.ts";
import type { Log } from "../runtime/types.ts";
import { ToolError, type ToolContext } from "../tools/types.ts";
import type { DoclingBlock, DoclingClient } from "./docling.ts";
import {
  PdfWorkerError,
  type PdfAnalysis,
  type PdfAnalyzer,
  type PdfBlock,
  type PdfRender,
} from "./pdf-worker.ts";
import { MAX_PDF_BLOCKS, MAX_PDF_BYTES, type AnalyzeOptions } from "./protocol.ts";

export interface PdfCaptureDeps {
  assets: AssetStore;
  ocr: OcrModel;
  /** Screens page images for vault secrets before they are stored or sent to OpenAI (A-M1). */
  localOcr: Pick<LocalOcr, "text">;
  docling: DoclingClient | null;
  /** The pdf-worker service: PDFs are parsed there, never in this process (B5 review I-1). */
  pdf: PdfAnalyzer;
  log: Log;
}

export interface PdfCapture {
  title: string;
  blocks: BlockDraft[];
  coverage: number;
  contentSha256: string;
  engine: "pdfjs" | "docling";
  /** Page 1 at scale 1 (the snapshot), or null when it was withheld. */
  pagePng: Uint8Array | null;
  /** The original PDF, or null when it is over the asset limit or its pixels could not be screened. */
  pdfAssetId: string | null;
  /** Why the original is not stored (shown on the note), or null when it is. */
  originalWithheld: "too_large" | "unscreened" | null;
  /** The document laid out into more than MAX_PDF_BLOCKS blocks; the note holds the first ones. */
  blocksTruncated: boolean;
  pages: number;
  /** Page images and page text (scanned, outlined, OCR'd empty, skipped by docling) the note does not hold. */
  mediaLost: number;
}

export type PdfCaptureContext = Pick<ToolContext, "workspaceId" | "signal" | "step" | "mask">;

const RENDER_SCALE = 2;
const anchor = (page: number, bbox: BBox) => ({
  selector: null,
  xpath: null,
  start: null,
  end: null,
  textFragment: null,
  page,
  bbox,
});
const isPdfBytes = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
const titleFrom = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || "PDF";
  } catch {
    return "PDF";
  }
};

/** A page render with nothing on it (I-4: a blank separator page is not missing text). */
async function isBlank(png: Uint8Array): Promise<boolean> {
  const { channels } = await sharp(png).flatten({ background: "#ffffff" }).stats();
  return channels.every((channel) => channel.min >= 250);
}

async function analyzeOrRefuse(
  pdf: PdfAnalyzer,
  bytes: Uint8Array,
  options: AnalyzeOptions,
  signal: AbortSignal,
): Promise<PdfAnalysis> {
  try {
    return await pdf.analyze(bytes, options, signal);
  } catch (error) {
    if (error instanceof PdfWorkerError)
      throw new ToolError("pdf_unavailable", "The PDF could not be read");
    throw error;
  }
}

/**
 * spec §7.6: docling when profile `pdf` is up, else pdf.js; both verified against the pdf.js text.
 * Text is screened for vault secrets before anything is stored; page images are screened locally
 * (self-hosted OCR) before they are stored or reach OpenAI, and withheld on a hit or OCR failure.
 */
export async function buildPdfCapture(
  deps: PdfCaptureDeps,
  ctx: PdfCaptureContext,
  bytes: Uint8Array,
  url: string,
): Promise<PdfCapture> {
  if (!isPdfBytes(bytes)) throw new ToolError("pdf_unavailable", "The document is not a PDF");
  const analysis = await analyzeOrRefuse(
    deps.pdf,
    bytes,
    { render: "auto", scale: RENDER_SCALE },
    ctx.signal,
  );
  const { pages, reference } = analysis;
  screenValue(ctx.mask, [reference, analysis.title]);
  const precision = precisionAgainst(reference);

  const renders = new Map<string, Uint8Array>();
  const rendered = new Set<string>();
  let rendersWithheld = 0;
  const keepClean = async (list: readonly PdfRender[]) => {
    for (const render of list) {
      rendered.add(`${render.page}@${render.scale}`);
      if (await pixelsAreClean(deps.localOcr, ctx.mask, render.png, ctx.signal))
        renders.set(`${render.page}@${render.scale}`, render.png);
      else rendersWithheld++;
    }
  };
  await keepClean(analysis.renders);
  const pageRender = (page: number) => renders.get(`${page}@${RENDER_SCALE}`);
  const textPages = new Set(pages.filter((p) => p.hasText).map((p) => p.page));
  let mediaLost = 0;

  const storePng = async (png: Uint8Array) => {
    const meta = await sharp(png).metadata();
    const input = {
      bytes: png,
      mime: "image/png",
      width: meta.width ?? null,
      height: meta.height ?? null,
      sourceUrl: null,
    };
    return (await deps.assets.put(ctx.workspaceId, input, ctx.mask)).assetId;
  };
  const crop = async (block: DoclingBlock): Promise<string | null> => {
    const png = pageRender(block.page);
    if (!png) return null;
    const meta = await sharp(png).metadata();
    const factor = (meta.width ?? 0) / (pages.find((p) => p.page === block.page)?.width ?? 1);
    const left = Math.max(0, Math.floor(block.bbox.x * factor));
    const top = Math.max(0, Math.floor(block.bbox.y * factor));
    const width = Math.max(
      1,
      Math.min((meta.width ?? 1) - left, Math.ceil(block.bbox.width * factor)),
    );
    const height = Math.max(
      1,
      Math.min((meta.height ?? 1) - top, Math.ceil(block.bbox.height * factor)),
    );
    if (left >= (meta.width ?? 0) || top >= (meta.height ?? 0)) return null;
    const region = await sharp(png).extract({ left, top, width, height }).png().toBuffer();
    return storePng(new Uint8Array(region));
  };
  const textBlock = (
    block: { type: BlockDraft["type"]; markdown: string },
    page: number,
    bbox: BBox,
    ocrPage: boolean,
  ): BlockDraft => {
    const plain = blockPlainText(block);
    return {
      type: block.type,
      markdown: block.markdown,
      origin: ocrPage ? "ocr_model" : "pdf",
      assetId: null,
      anchor: anchor(page, bbox),
      verified: !ocrPage && (plain === "" || precision(plain) >= VERIFIED_COVERAGE),
    };
  };

  let engine: PdfCapture["engine"] = "pdfjs";
  const blocks: BlockDraft[] = [];
  if (deps.docling) {
    try {
      const converted = await deps.docling.convert(bytes, "document.pdf", ctx.signal);
      // docling OCRs image-only pages: its text is screened before any crop is stored.
      screenValue(
        ctx.mask,
        converted.map((block) => block.markdown),
      );
      const missing = [
        ...new Set(
          converted
            .filter((b) => b.crop && !rendered.has(`${b.page}@${RENDER_SCALE}`))
            .map((b) => b.page),
        ),
      ];
      if (missing.length > 0) {
        const extra = await deps.pdf.analyze(
          bytes,
          { render: missing, scale: RENDER_SCALE },
          ctx.signal,
        );
        await keepClean(extra.renders);
      }
      let lost = 0;
      for (const block of converted) {
        ctx.signal.throwIfAborted();
        if (block.crop) {
          const id = await crop(block);
          // Q7: docling text is a caption here, escaped; the image itself is the block's assetId (decision 14).
          if (id) {
            const caption = escapeMarkdownText(block.markdown);
            blocks.push(figureBlock("figure", caption, id, anchor(block.page, block.bbox)));
          } else lost++;
        } else {
          const ocrPage = !textPages.has(block.page);
          for (const part of limitBlockSize(block))
            blocks.push(textBlock(part, block.page, block.bbox, ocrPage));
        }
      }
      // I-4: a page without a text layer that docling gave no text is missing text, unless blank.
      const read = new Set(converted.filter((b) => !b.crop).map((b) => b.page));
      for (const page of pages) {
        if (page.hasText || read.has(page.page)) continue;
        const png = pageRender(page.page);
        if (!png || !(await isBlank(png))) lost++;
      }
      engine = "docling";
      mediaLost += lost;
    } catch (error) {
      if (ctx.signal.aborted || error instanceof ToolError || error instanceof NoteWriteError)
        throw error;
      deps.log.warn({ errName: (error as Error).name }, "docling failed; falling back to pdf.js");
      blocks.length = 0;
    }
  }
  if (engine === "pdfjs") {
    // One pass, pushed in place (re-review N-1), over at most MAX_PDF_BLOCKS blocks.
    const laid = new Map<number, PdfBlock[]>();
    for (const block of analysis.blocks.slice(0, MAX_PDF_BLOCKS)) {
      const onPage = laid.get(block.page);
      if (onPage) onPage.push(block);
      else laid.set(block.page, [block]);
    }
    for (const page of pages) {
      ctx.signal.throwIfAborted();
      for (const block of laid.get(page.page) ?? [])
        for (const part of limitBlockSize(block))
          blocks.push(textBlock(part, page.page, block.bbox, false));
      if (page.hasText && !page.hasImages) continue;
      const png = pageRender(page.page);
      if (!png) {
        mediaLost++;
        continue;
      }
      const whole = { x: 0, y: 0, width: page.width, height: page.height };
      const label = `Page ${page.page}`;
      if (page.hasText) {
        const id = await storePng(png);
        blocks.push(figureBlock("figure", label, id, anchor(page.page, whole)));
        continue;
      }
      // I-4: no text layer (scanned, or text drawn as outlines): read like a scanned page.
      if (await isBlank(png)) continue;
      // Transcribed, and the text screened, before the image is stored.
      let text: string | null;
      try {
        text = (await deps.ocr.transcribe(png, { signal: ctx.signal, step: ctx.step })).trim();
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        deps.log.warn({ errName: (error as Error).name }, "OCR failed for a PDF page");
        text = null;
      }
      if (text !== null) screenText(ctx.mask, text);
      // Unread pixels are never stored while the run holds secrets (re-review I1).
      if (text === null && ctx.mask.hasSecrets()) {
        mediaLost++;
        continue;
      }
      const id = await storePng(png);
      blocks.push(figureBlock("image", label, id, anchor(page.page, whole)));
      // I-4: a page that shows something but reads as no text is missing text, not an empty page.
      if (!text) {
        mediaLost++;
        continue;
      }
      // Headings, lists and paragraphs stay separate blocks, each within the size limit (M4).
      for (const part of splitMarkdown(text).flatMap((block) => limitBlockSize(block)))
        blocks.push({
          ...part,
          origin: "ocr_model",
          assetId: null,
          anchor: anchor(page.page, whole),
          verified: false,
        });
    }
  }

  // The original keeps every page's pixels: stored only once each image page passed the screen.
  const imagePages = pages.filter((p) => p.hasImages || !p.hasText).map((p) => p.page);
  const pixelsScreened =
    rendersWithheld === 0 &&
    (!ctx.mask.hasSecrets() || imagePages.every((page) => pageRender(page) !== undefined));
  // Text past the block cap is not in the note: it counts as missing, so the note is partial.
  const blocksTruncated =
    engine === "pdfjs" && (analysis.truncated || analysis.blocks.length > MAX_PDF_BLOCKS);
  if (blocksTruncated) mediaLost++;
  const capturedText = blocks
    .filter((b) => b.origin !== "ocr_model")
    .map((b) => blockPlainText(b))
    .join("\n");
  return {
    title: analysis.title ?? titleFrom(url),
    blocks,
    coverage: coverageOf(reference, capturedText).coverage,
    contentSha256: sha256Hex(bytes),
    engine,
    pagePng: renders.get("1@1") ?? null,
    ...(pixelsScreened
      ? await storeOriginal(deps, ctx, bytes, url)
      : { pdfAssetId: null, originalWithheld: "unscreened" as const }),
    pages: pages.length,
    mediaLost,
    blocksTruncated,
  };
}

function figureBlock(
  type: "figure" | "image",
  markdown: string,
  assetId: string,
  at: ReturnType<typeof anchor>,
): BlockDraft {
  return { type, markdown, origin: "pdf", assetId, anchor: at, verified: true };
}

/**
 * PDFs over the asset limit (25 MiB; PDFs up to 100 MiB are captured) keep their blocks and page
 * images, not the original file; the note records why. Revisit once object reads stream (S8).
 */
async function storeOriginal(
  deps: PdfCaptureDeps,
  ctx: PdfCaptureContext,
  bytes: Uint8Array,
  url: string,
): Promise<Pick<PdfCapture, "pdfAssetId" | "originalWithheld">> {
  try {
    const input = { bytes, mime: "application/pdf", width: null, height: null, sourceUrl: url };
    const { assetId } = await deps.assets.put(ctx.workspaceId, input, ctx.mask);
    return { pdfAssetId: assetId, originalWithheld: null };
  } catch (error) {
    if (error instanceof AssetRejected) return { pdfAssetId: null, originalWithheld: "too_large" };
    throw error;
  }
}

/** The PDF on screen, fetched by the browser under the network policy (preflight S1), then captured. */
export async function capturePdf(
  deps: PdfCaptureDeps,
  ctx: ToolContext,
): Promise<PdfCapture & { url: string }> {
  const url = ctx.session.page.url();
  const worlds = await ctx.session.worlds();
  const fetched = await fetchInBrowser(
    { session: ctx.session, frameId: await worlds.mainFrameId(), signal: ctx.signal },
    url,
    MAX_PDF_BYTES,
  );
  if (!fetched)
    throw new ToolError("pdf_unavailable", "The PDF could not be downloaded in the browser");
  return { ...(await buildPdfCapture(deps, ctx, fetched.bytes, url)), url };
}
