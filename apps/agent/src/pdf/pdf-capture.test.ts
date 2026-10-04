import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import type { LocalOcr } from "../browser/local-ocr.ts";
import { StepCollector } from "../loop/step-collector.ts";
import type { AssetInput, AssetStore } from "../notes/assets.ts";
import { startTestPdfWorker } from "../testing/pdf-worker.ts";
import { testLog } from "../testing/tool-context.ts";
import { createOcrModel } from "../capture/opaque.ts";
import { createDoclingClient } from "./docling.ts";
import { buildPdfCapture, type PdfCaptureDeps } from "./pdf-capture.ts";
import { MAX_PDF_BLOCKS } from "./protocol.ts";

const fixture = async () =>
  new Uint8Array(
    await readFile(new URL("../../../../tests/fixtures/sites/site/pdf/paper.pdf", import.meta.url)),
  );
const recordingAssets = () => {
  const stored: AssetInput[] = [];
  const store: AssetStore = {
    put: async (_ws, input) => (
      stored.push(input),
      {
        assetId: crypto.randomUUID(),
        sha256: "x",
        mime: input.mime,
        bytes: input.bytes.length,
        width: input.width,
        height: input.height,
      }
    ),
  };
  return { store, stored };
};
const assets = recordingAssets().store;
const cleanOcr: Pick<LocalOcr, "text"> = { text: async () => "" };
const ctx = (mask: MaskSources = NO_MASK_SOURCES) => ({
  workspaceId: "w",
  signal: new AbortController().signal,
  step: new StepCollector(),
  mask,
});
let worker: Awaited<ReturnType<typeof startTestPdfWorker>>;
beforeAll(async () => {
  worker = await startTestPdfWorker();
});
afterAll(async () => {
  await worker?.close();
});
const deps = (over: Partial<PdfCaptureDeps> = {}): PdfCaptureDeps => ({
  assets,
  ocr: { transcribe: async () => "" },
  localOcr: cleanOcr,
  docling: null,
  pdf: worker.client,
  log: testLog,
  ...over,
});
/** A one-page PDF whose only content is a vector path: text drawn as outlines, no text layer, no image. */
const outlinedPdf = async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawSvgPath("M 0 0 L 200 0 L 200 40 L 0 40 Z M 20 10 L 60 30", {
    x: 72,
    y: 700,
  });
  return doc.save();
};
const blankPdf = async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
};
const vault: MaskSources = {
  nodeIds: () => [],
  hasSecrets: () => true,
  redact: (text) => text.replaceAll("hunter2", "[secret]").replaceAll("rubisco", "[secret]"),
};

describe("buildPdfCapture (pdf.js path)", () => {
  it("verifies the fixture against the pdf.js text and flags the scanned page", async () => {
    const ocrCalls: number[] = [];
    const capture = await buildPdfCapture(
      deps({
        ocr: { transcribe: async (png) => (ocrCalls.push(png.length), "Scanned page text") },
      }),
      ctx(),
      await fixture(),
      "https://x.test/paper.pdf",
    );
    expect(capture.engine).toBe("pdfjs");
    expect(capture.title).toBe("Photosynthesis: A Short Primer");
    expect(capture.coverage).toBeGreaterThanOrEqual(0.98);
    expect(capture.blocks.map((b) => b.type)).toEqual(
      expect.arrayContaining(["heading", "paragraph", "list", "figure", "image"]),
    );
    const para = capture.blocks.find((b) => b.markdown.startsWith("In the stroma"))!;
    expect(para).toMatchObject({
      origin: "pdf",
      verified: true,
      anchor: { page: 2, bbox: expect.objectContaining({ x: expect.any(Number) }) },
    });
    const figure = capture.blocks.find((b) => b.type === "figure" && b.anchor?.page === 1)!;
    expect(figure).toMatchObject({ markdown: "Page 1", assetId: expect.any(String) });
    expect(capture.blocks.indexOf(figure)).toBeLessThan(
      capture.blocks.findIndex((b) => b.anchor?.page === 2),
    );
    expect(capture.blocks.find((b) => b.origin === "ocr_model")).toMatchObject({
      verified: false,
      anchor: { page: 3 },
    });
    expect(ocrCalls).toHaveLength(1);
    expect(capture.pagePng?.slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
    expect(capture).toMatchObject({ pdfAssetId: expect.any(String), mediaLost: 0, pages: 3 });
  });
  it("refuses bytes that are not a PDF", async () => {
    await expect(
      buildPdfCapture(deps(), ctx(), new TextEncoder().encode("<html>"), "https://x.test/a.pdf"),
    ).rejects.toMatchObject({ code: "pdf_unavailable" });
  });
  it("escapes docling captions and keeps them as caption text (Q7)", async () => {
    const capture = await buildPdfCapture(
      deps({
        docling: {
          convert: async () => [
            {
              type: "figure",
              markdown: "Figure 1 ] [x](javascript:y)",
              page: 1,
              bbox: { x: 72, y: 400, width: 240, height: 140 },
              crop: true,
            },
          ],
        },
      }),
      ctx(),
      await fixture(),
      "https://x.test/paper.pdf",
    );
    expect(capture.engine).toBe("docling");
    expect(capture.blocks[0]).toMatchObject({
      type: "figure",
      markdown: "Figure 1 \\] \\[x\\](javascript:y)",
      assetId: expect.any(String),
    });
  });
});

describe("buildPdfCapture on runs holding vault secrets", () => {
  it("refuses a PDF whose text layer shows a secret before storing anything", async () => {
    const { store, stored } = recordingAssets();
    await expect(
      buildPdfCapture(deps({ assets: store }), ctx(vault), await fixture(), "https://x.test/p.pdf"),
    ).rejects.toMatchObject({ code: "secret_on_page" });
    expect(stored).toEqual([]);
  });
  it("withholds page images the local screen flags, never sending them to OpenAI", async () => {
    const mask: MaskSources = { ...vault, redact: (t) => t.replaceAll("hunter2", "[secret]") };
    const { store, stored } = recordingAssets();
    const ocrCalls: number[] = [];
    for (const localOcr of [
      { text: async () => "password hunter2" },
      {
        text: async () => {
          throw new Error("tesseract failed");
        },
      },
    ]) {
      const capture = await buildPdfCapture(
        deps({
          assets: store,
          localOcr,
          ocr: { transcribe: async (png) => (ocrCalls.push(png.length), "Scanned page text") },
        }),
        ctx(mask),
        await fixture(),
        "https://x.test/p.pdf",
      );
      expect(capture).toMatchObject({ pagePng: null, pdfAssetId: null, mediaLost: 2 });
      expect(capture.blocks.some((b) => b.assetId !== null)).toBe(false);
    }
    expect(ocrCalls).toEqual([]);
    expect(stored).toEqual([]);
  });
  it("screens what OCR read on a scanned page before the image is stored", async () => {
    const mask: MaskSources = { ...vault, redact: (t) => t.replaceAll("hunter2", "[secret]") };
    const { store, stored } = recordingAssets();
    await expect(
      buildPdfCapture(
        deps({ assets: store, ocr: { transcribe: async () => "login hunter2" } }),
        ctx(mask),
        await fixture(),
        "https://x.test/p.pdf",
      ),
    ).rejects.toMatchObject({ code: "secret_on_page" });
    expect(stored.map((s) => s.mime)).toEqual(["image/png"]);
  });
  it("screens docling's text before any crop is stored", async () => {
    const mask: MaskSources = { ...vault, redact: (t) => t.replaceAll("hunter2", "[secret]") };
    const { store, stored } = recordingAssets();
    const box = { x: 72, y: 400, width: 240, height: 140 };
    await expect(
      buildPdfCapture(
        deps({
          assets: store,
          docling: {
            convert: async () => [
              { type: "figure", markdown: "Figure 1", page: 1, bbox: box, crop: true },
              { type: "paragraph", markdown: "token hunter2", page: 3, bbox: box, crop: false },
            ],
          },
        }),
        ctx(mask),
        await fixture(),
        "https://x.test/p.pdf",
      ),
    ).rejects.toMatchObject({ code: "secret_on_page" });
    expect(stored).toEqual([]);
  });
});

describe("buildPdfCapture never calls a page with missing text verified (I-4)", () => {
  it("reads a page of outlined text like a scanned page and counts it missing when OCR finds nothing", async () => {
    const ocrCalls: number[] = [];
    const capture = await buildPdfCapture(
      deps({ ocr: { transcribe: async (png) => (ocrCalls.push(png.length), "") } }),
      ctx(),
      await outlinedPdf(),
      "https://x.test/outlined.pdf",
    );
    expect(ocrCalls).toHaveLength(1);
    expect(capture.mediaLost).toBe(1);
    expect(capture.blocks).toMatchObject([{ type: "image", markdown: "Page 1" }]);
  });
  it("keeps OCR text of an outlined page as unverified ocr_model blocks", async () => {
    const capture = await buildPdfCapture(
      deps({ ocr: { transcribe: async () => "Outlined heading" } }),
      ctx(),
      await outlinedPdf(),
      "https://x.test/outlined.pdf",
    );
    expect(capture.mediaLost).toBe(0);
    expect(capture.blocks.find((b) => b.origin === "ocr_model")).toMatchObject({ verified: false });
  });
  it("counts a scanned page whose OCR comes back empty as missing", async () => {
    const capture = await buildPdfCapture(deps(), ctx(), await fixture(), "https://x.test/p.pdf");
    expect(capture.mediaLost).toBe(1);
  });
  it("counts a scanned page docling gave no text as missing", async () => {
    const capture = await buildPdfCapture(
      deps({ docling: { convert: async () => [] } }),
      ctx(),
      await fixture(),
      "https://x.test/p.pdf",
    );
    expect(capture).toMatchObject({ engine: "docling", mediaLost: 1 });
  });
  it("does not count a blank page as missing text", async () => {
    let ocrCalls = 0;
    const capture = await buildPdfCapture(
      deps({ ocr: { transcribe: async () => (ocrCalls++, "") } }),
      ctx(),
      await blankPdf(),
      "https://x.test/blank.pdf",
    );
    expect(ocrCalls).toBe(0);
    expect(capture.mediaLost).toBe(0);
  });
});

describe("buildPdfCapture records why the original PDF is missing", () => {
  it("says too_large when the asset store refuses the original", async () => {
    const { AssetRejected } = await import("../notes/assets.ts");
    const store: AssetStore = {
      put: async (ws, input, mask) => {
        if (input.mime === "application/pdf") throw new AssetRejected("asset too large");
        return assets.put(ws, input, mask);
      },
    };
    const capture = await buildPdfCapture(
      deps({ assets: store, ocr: { transcribe: async () => "Scanned page text" } }),
      ctx(),
      await fixture(),
      "https://x.test/p.pdf",
    );
    expect(capture).toMatchObject({ pdfAssetId: null, originalWithheld: "too_large" });
  });
  it("says unscreened when page pixels were withheld on a secret-holding run", async () => {
    const mask: MaskSources = { ...vault, redact: (t) => t.replaceAll("hunter2", "[secret]") };
    const capture = await buildPdfCapture(
      deps({ localOcr: { text: async () => "hunter2" } }),
      ctx(mask),
      await fixture(),
      "https://x.test/p.pdf",
    );
    expect(capture).toMatchObject({ pdfAssetId: null, originalWithheld: "unscreened" });
  });
});

describe("buildPdfCapture verification cost (I-3)", () => {
  it("scores 3,000 blocks against a 150k-token reference in under 3 seconds", async () => {
    const words = Array.from({ length: 150_000 }, (_, i) => `w${i % 20_000}`);
    const blocks = Array.from({ length: 3_000 }, (_, i) => ({
      type: "paragraph" as const,
      markdown: words.slice(i * 50, i * 50 + 50).join(" "),
      page: 1,
      bbox: { x: 0, y: i, width: 10, height: 1 },
    }));
    const pdf = {
      analyze: async () => ({
        title: "Big",
        pages: [{ page: 1, width: 612, height: 792, hasImages: false, hasText: true }],
        reference: words.join(" "),
        blocks,
        truncated: false,
        renders: [],
      }),
    };
    const started = performance.now();
    const capture = await buildPdfCapture(
      deps({ pdf }),
      ctx(),
      await blankPdf(),
      "https://x.test/big.pdf",
    );
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(capture.blocks.every((b) => b.verified)).toBe(true);
  });
});

describe("buildPdfCapture with a huge pdf.js layout (re-review N-1)", () => {
  it("groups 100k blocks on one page in one pass, keeps MAX_PDF_BLOCKS and marks the note partial", async () => {
    const blocks = Array.from({ length: 100_000 }, (_, i) => ({
      type: "heading" as const,
      markdown: `# h${i}`,
      page: 1,
      bbox: { x: 0, y: i, width: 10, height: 1 },
    }));
    const pdf = {
      analyze: async () => ({
        title: "Huge",
        pages: [{ page: 1, width: 612, height: 792, hasImages: false, hasText: true }],
        reference: blocks.map((b) => b.markdown.slice(2)).join(" "),
        blocks,
        truncated: true,
        renders: [],
      }),
    };
    const started = performance.now();
    const capture = await buildPdfCapture(
      deps({ pdf }),
      ctx(),
      await blankPdf(),
      "https://x.test/h.pdf",
    );
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(capture.blocks).toHaveLength(MAX_PDF_BLOCKS);
    expect(capture).toMatchObject({ blocksTruncated: true, mediaLost: 1 });
  });
});

describe("buildPdfCapture keeps to the run's budget (final review I6)", () => {
  it("stops OCR when the budget is spent and counts the scanned page as lost", async () => {
    let calls = 0;
    const ocr = createOcrModel({
      responses: {
        create: async () => {
          throw new Error("unused");
        },
        parse: async () => {
          calls++;
          return {
            parsed: { markdown: "Scanned page text" } as never,
            model: "gpt-6-astra",
            tokens: { input: 1, cached: 0, output: 1 },
          };
        },
      },
    });
    const capture = await buildPdfCapture(
      deps({ ocr }),
      { ...ctx(), step: new StepCollector({ usdLeft: 0 }) },
      await fixture(),
      "https://x.test/p.pdf",
    );
    expect(calls).toBe(0);
    expect(capture.mediaLost).toBe(1);
  });
});

describe("buildPdfCapture with docling down (final review I7)", () => {
  it("falls back to pdf.js when docling cannot be reached", async () => {
    // Nothing listens on port 9: what a docling container that is down or loading looks like.
    const capture = await buildPdfCapture(
      deps({
        docling: createDoclingClient("http://127.0.0.1:9"),
        ocr: { transcribe: async () => "Scanned page text" },
      }),
      ctx(),
      await fixture(),
      "https://x.test/paper.pdf",
    );
    expect(capture.engine).toBe("pdfjs");
    expect(capture.coverage).toBeGreaterThanOrEqual(0.98);
  });
});
