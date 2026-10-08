import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfPageText } from "../protocol.ts";
import type { ChildRequest, ChildResult } from "./protocol.ts";

class TooLarge extends Error {}

const require = createRequire(import.meta.url);
const PDFJS_DIR = dirname(require.resolve("pdfjs-dist/package.json"));
/** Q8: the standard-14 fonts and CJK maps ship with pdf.js; without them Node renders some text wrongly. */
const STANDARD_FONTS = `${join(PDFJS_DIR, "standard_fonts")}/`;
const CMAPS = `${join(PDFJS_DIR, "cmaps")}/`;
const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
]);

/** I-3: items per page and characters overall are bounded here, before anything is laid out. */
async function readPages(doc: PDFDocumentProxy, limits: ChildRequest): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = [];
  let chars = 0;
  let total = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    const items = content.items.flatMap((raw) => {
      if (!("str" in raw) || raw.str.length === 0) return [];
      const [, , , , x, baseline] = raw.transform as number[];
      return [
        {
          str: raw.str,
          x: x ?? 0,
          y: viewport.height - (baseline ?? 0) - raw.height,
          width: raw.width,
          height: raw.height,
          hasEOL: raw.hasEOL,
        },
      ];
    });
    chars += items.reduce((sum, item) => sum + item.str.length, 0);
    total += items.length;
    if (
      items.length > limits.maxPageItems ||
      total > limits.maxDocumentItems ||
      chars > limits.maxTextChars
    )
      throw new TooLarge();
    pages.push({
      page: n,
      width: viewport.width,
      height: viewport.height,
      items,
      hasImages: ops.fnArray.some((op) => IMAGE_OPS.has(op)),
    });
    page.cleanup();
  }
  return pages;
}

async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  maxPixels: number,
): Promise<Buffer> {
  const page = await doc.getPage(pageNumber);
  const unit = page.getViewport({ scale: 1 });
  const fitted = Math.min(scale, Math.sqrt(maxPixels / Math.max(1, unit.width * unit.height)));
  const viewport = page.getViewport({ scale: fitted });
  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  page.cleanup();
  return canvas.toBuffer("image/png");
}

async function titleOf(doc: PDFDocumentProxy): Promise<string | null> {
  const meta = await doc.getMetadata().catch(() => null);
  const title = (meta?.info as { Title?: string } | undefined)?.Title?.trim();
  return title ? title.slice(0, 500) : null;
}

/** Everything the agent needs from one parse: text layer, title, renders. Runs only inside the worker. */
export async function analyze(request: ChildRequest, bytes: Uint8Array): Promise<ChildResult> {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
    return { ok: false, error: "not_pdf" };
  const task = getDocument({
    data: new Uint8Array(bytes),
    // pdfjs-dist 6 has no font eval path (isEvalSupported is gone); the worker also runs with
    // --disallow-code-generation-from-strings, which closes CVE-2024-4367's class for good.
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    // I-2: an image or canvas past these bounds is skipped, never allocated.
    maxImageSize: request.maxImagePixels,
    canvasMaxAreaInBytes: request.maxPixels * 4,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages > request.maxPages) return { ok: false, error: "too_large" };
    const pages = await readPages(doc, request);
    const wanted =
      request.render === "auto"
        ? [
            { page: 1, scale: 1 },
            ...pages
              .filter((p) => p.hasImages || p.items.length === 0)
              .map((p) => ({ page: p.page, scale: request.scale })),
          ]
        : request.render.map((page) => ({ page, scale: request.scale }));
    const renders: { page: number; scale: number; png: string }[] = [];
    let renderBytes = 0;
    for (const { page, scale } of wanted.slice(0, request.maxRenders)) {
      if (page < 1 || page > doc.numPages) continue;
      const png = await renderPage(doc, page, scale, request.maxPixels);
      // Past the byte budget a page goes without a render (the agent counts it missing, N-7).
      if (renderBytes + png.length > request.maxRenderBytes) continue;
      renderBytes += png.length;
      renders.push({ page, scale, png: png.toString("base64") });
    }
    return { ok: true, title: await titleOf(doc), pages, renders };
  } catch (error) {
    return { ok: false, error: error instanceof TooLarge ? "too_large" : "parse_failed" };
  } finally {
    // G3: in pdfjs-dist 6.4.299 the loading task owns teardown; PDFDocumentProxy has no destroy().
    await task.destroy();
  }
}
