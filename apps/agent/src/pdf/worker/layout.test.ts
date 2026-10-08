import { describe, expect, it } from "vitest";
import { pdfBlocks } from "./layout.ts";
import type { PdfPageText } from "../protocol.ts";

const item = (str: string, y: number, height = 11, x = 72) => ({
  str,
  x,
  y,
  width: str.length * 5,
  height,
  hasEOL: true,
});

describe("pdfBlocks", () => {
  it("groups lines into headings, paragraphs and lists with page bboxes", () => {
    const page: PdfPageText = {
      page: 1,
      width: 612,
      height: 792,
      hasImages: false,
      items: [
        item("Big Title", 50, 22),
        item("First line of a para-", 100),
        item("graph continues here.", 115),
        item("Second paragraph after a gap.", 160),
        item("• one", 200),
        item("• two #1", 215),
        item("1. numbered", 240),
      ],
    };
    const blocks = pdfBlocks([page]);
    expect(blocks.map((b) => [b.type, b.markdown])).toEqual([
      ["heading", "# Big Title"],
      ["paragraph", "First line of a para-graph continues here."],
      ["paragraph", "Second paragraph after a gap."],
      ["list", "- one\n- two #1"],
      ["list", "1. numbered"],
    ]);
    expect(blocks[1]).toMatchObject({
      page: 1,
      bbox: { x: 72, y: 100, width: expect.any(Number), height: expect.any(Number) },
    });
  });
  it("lays out 50k items on one page in well under a second (I-3: no quadratic line search)", () => {
    const items = Array.from({ length: 50_000 }, (_, i) => item(`word${i}`, i, 1));
    const page: PdfPageText = { page: 1, width: 612, height: 792, hasImages: false, items };
    const started = performance.now();
    const blocks = pdfBlocks([page]);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(blocks.map((b) => b.text).join(" ")).toContain("word49999");
  });
});
