import { describe, expect, it } from "vitest";
import { DoclingDocument, doclingBlocks } from "./docling.ts";

const prov = (page: number, t = 700) => [
  { page_no: page, bbox: { l: 72, t, r: 300, b: t - 20, coord_origin: "BOTTOMLEFT" } },
];
const doc = DoclingDocument.parse({
  body: {
    children: [
      { $ref: "#/texts/0" },
      { $ref: "#/texts/1" },
      { $ref: "#/groups/0" },
      { $ref: "#/tables/0" },
      { $ref: "#/tables/1" },
      { $ref: "#/pictures/0" },
      { $ref: "#/texts/5" },
      { $ref: "#/texts/6" },
    ],
  },
  texts: [
    { self_ref: "#/texts/0", label: "title", text: "Primer", prov: prov(1) },
    { self_ref: "#/texts/1", label: "text", text: "Plants *use* light.", prov: prov(1, 650) },
    { self_ref: "#/texts/2", label: "list_item", text: "one", prov: prov(1, 600) },
    { self_ref: "#/texts/3", label: "list_item", text: "two", prov: prov(1, 585) },
    { self_ref: "#/texts/4", label: "caption", text: "Figure 1. Chloroplast.", prov: prov(1, 300) },
    { self_ref: "#/texts/5", label: "page_footer", text: "Page 1", prov: prov(1, 30) },
    { self_ref: "#/texts/6", label: "formula", text: "", prov: prov(2, 500) },
  ],
  groups: [
    {
      self_ref: "#/groups/0",
      label: "list",
      children: [{ $ref: "#/texts/2" }, { $ref: "#/texts/3" }],
    },
  ],
  tables: [
    {
      self_ref: "#/tables/0",
      label: "table",
      prov: prov(2),
      data: {
        grid: [
          [{ text: "Input" }, { text: "Out|put" }],
          [{ text: "CO2" }, { text: "Glucose" }],
        ],
      },
    },
    {
      self_ref: "#/tables/1",
      label: "table",
      prov: prov(2, 400),
      data: {
        grid: [
          [{ text: "A", row_span: 2 }, { text: "B" }],
          [{ text: "A", row_span: 2 }, { text: "C" }],
        ],
      },
    },
  ],
  pictures: [
    {
      self_ref: "#/pictures/0",
      label: "picture",
      prov: prov(1, 400),
      captions: [{ $ref: "#/texts/4" }],
    },
  ],
  pages: {
    "1": { size: { width: 612, height: 792 }, page_no: 1 },
    "2": { size: { width: 612, height: 792 }, page_no: 2 },
  },
});

describe("doclingBlocks", () => {
  it("renders reading order, lists, tables, pictures and skips furniture", () => {
    const blocks = doclingBlocks(doc);
    expect(blocks.map((b) => [b.type, b.crop ? "crop" : b.markdown])).toEqual([
      ["heading", "# Primer"],
      ["paragraph", "Plants \\*use\\* light."],
      ["list", "- one\n- two"],
      ["table", "| Input | Out\\|put |\n| --- | --- |\n| CO2 | Glucose |"],
      ["table", '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>'],
      ["figure", "crop"],
      ["paragraph", "Figure 1. Chloroplast."],
      ["math", "crop"],
    ]);
    expect(blocks[0]!.bbox).toEqual({ x: 72, y: 92, width: 228, height: 20 });
    expect(blocks.find((b) => b.type === "figure")!.markdown).toBe("Figure 1. Chloroplast.");
  });
});
