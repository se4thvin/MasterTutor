import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import type { LocalOcr } from "../capture/local-ocr.ts";
import { StepCollector } from "../loop/step-collector.ts";
import type { AssetInput, AssetStore } from "../notes/assets.ts";
import { testLog } from "../testing/tool-context.ts";
import { buildPdfCapture, type PdfCaptureDeps } from "./pdf-capture.ts";

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
const cleanOcr: LocalOcr = { text: async () => "" };
const ctx = (mask: MaskSources = NO_MASK_SOURCES) => ({
  workspaceId: "w",
  signal: new AbortController().signal,
  step: new StepCollector(),
  mask,
});
const deps = (over: Partial<PdfCaptureDeps> = {}): PdfCaptureDeps => ({
  assets,
  ocr: { transcribe: async () => "" },
  localOcr: cleanOcr,
  docling: null,
  log: testLog,
  ...over,
});
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
