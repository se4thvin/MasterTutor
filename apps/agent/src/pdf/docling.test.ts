import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  checkedBlocks,
  createDoclingClient,
  DoclingDocument,
  DoclingRejected,
  doclingBlocks,
  MAX_DOCLING_BLOCKS,
  MAX_DOCLING_CROPS_PER_PAGE,
  type DoclingBlock,
} from "./docling.ts";

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

describe("docling answers are bounded (B5 review I-6)", () => {
  const block = (page: number, crop: boolean): DoclingBlock => ({
    type: crop ? "figure" : "paragraph",
    markdown: "x",
    page,
    bbox: { x: 0, y: 0, width: 1, height: 1 },
    crop,
  });
  it("refuses too many blocks or crops on one page", () => {
    expect(checkedBlocks([block(1, true), block(1, false)])).toHaveLength(2);
    expect(() =>
      checkedBlocks(Array.from({ length: MAX_DOCLING_BLOCKS + 1 }, () => block(1, false))),
    ).toThrow(DoclingRejected);
    expect(() =>
      checkedBlocks(Array.from({ length: MAX_DOCLING_CROPS_PER_PAGE + 1 }, () => block(2, true))),
    ).toThrow(DoclingRejected);
  });
  it("rejects an answer that is off-schema", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "success",
          document: { json_content: { body: { children: "x" } } },
        }),
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const client = createDoclingClient(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      );
      await expect(
        client.convert(new Uint8Array([1]), "a.pdf", new AbortController().signal),
      ).rejects.toBeInstanceOf(DoclingRejected);
    } finally {
      server.close();
    }
  });
});

describe("doclingBlocks Markdown escaping (QA-104)", () => {
  const one = (texts: unknown[], tables: unknown[] = []) =>
    doclingBlocks(
      DoclingDocument.parse({
        body: {
          children: [
            ...texts.map((_, i) => ({ $ref: `#/texts/${i}` })),
            ...tables.map((_, i) => ({ $ref: `#/tables/${i}` })),
          ],
        },
        texts,
        groups: [],
        tables,
        pictures: [],
        pages: {},
      }),
    );
  it("fences code longer than any backtick run in it, and keeps the language a plain word", () => {
    const [block] = one([
      {
        self_ref: "#/texts/0",
        label: "code",
        text: "a\n```\n[x](https://evil.test)",
        code_language: "js\n```\n# Owned",
        prov: prov(1),
      },
    ]);
    expect(block?.markdown).toBe("````js\na\n```\n[x](https://evil.test)\n````");
  });
  it("keeps $$ inside a formula from closing the math block", () => {
    const [block] = one([
      {
        self_ref: "#/texts/0",
        label: "formula",
        text: "x$$\n[y](https://evil.test)",
        prov: prov(1),
      },
    ]);
    expect(block?.markdown).toBe("$$\nx\\$\\$\n[y](https://evil.test)\n$$");
  });
  it("escapes Markdown in simple table cells", () => {
    const [block] = one(
      [],
      [
        {
          self_ref: "#/tables/0",
          label: "table",
          prov: prov(1),
          data: { grid: [[{ text: "[a](https://evil.test)" }, { text: "*b*|c" }]] },
        },
      ],
    );
    expect(block?.markdown.split("\n")[0]).toBe("| \\[a\\](https://evil.test) | \\*b\\*\\|c |");
  });
});
