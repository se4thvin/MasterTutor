import { describe, expect, it } from "vitest";
import type { PageExtract } from "./page/types.ts";
import { assembleBlocks, verifyBlock } from "./web-capture.ts";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const extract: PageExtract = {
  engine: "defuddle",
  title: "T",
  description: null,
  canonicalUrl: null,
  faviconUrl: null,
  language: "en",
  markdown: [
    "Para one.",
    "",
    "![Chart](https://mt-media.invalid/0)",
    "",
    "MTRAWTABLE0",
    "",
    "Inline ![gone](https://mt-media.invalid/1) and ![kept](https://mt-media.invalid/2) images.",
    "",
    "![Hero](https://mt-media.invalid/3) ![Lost](https://mt-media.invalid/1)",
    "",
    "MTFRAME0",
  ].join("\n"),
  sourceText: "Para one.",
  pageText: "Para one.",
  mathTex: [],
  rawTables: ['<table><tr><td rowspan="2">x</td></tr></table>'],
  frames: [{ index: 0, url: "https://x.test/f", name: null }],
  media: [
    {
      index: 0,
      kind: "canvas",
      url: null,
      svg: null,
      dataUrl: null,
      alt: "Chart",
      rect: null,
      selector: "#c",
      figure: true,
    },
    {
      index: 1,
      kind: "img",
      url: null,
      svg: null,
      dataUrl: null,
      alt: "gone",
      rect: null,
      selector: null,
      figure: false,
    },
    {
      index: 2,
      kind: "img",
      url: null,
      svg: null,
      dataUrl: null,
      alt: "kept",
      rect: null,
      selector: null,
      figure: false,
    },
    {
      index: 3,
      kind: "img",
      url: null,
      svg: null,
      dataUrl: null,
      alt: "Hero",
      rect: null,
      selector: "#h",
      figure: false,
    },
  ],
};

describe("assembleBlocks (decision 14: media blocks carry the image in assetId)", () => {
  it("resolves media, raw tables and frame placeholders", () => {
    const blocks = assembleBlocks(
      extract,
      new Map([
        [0, { assetId: A, screenshotAssetId: B }],
        [1, { assetId: null, screenshotAssetId: null }],
        [2, { assetId: A, screenshotAssetId: null }],
        [3, { assetId: null, screenshotAssetId: B }],
      ]),
    );
    expect(blocks).toEqual([
      {
        kind: "block",
        block: { type: "paragraph", markdown: "Para one." },
        assetId: null,
        selector: null,
      },
      {
        kind: "block",
        block: { type: "figure", markdown: `Chart\n\n[Rendered view](asset:${B})` },
        assetId: A,
        selector: "#c",
      },
      {
        kind: "block",
        block: { type: "table", markdown: '<table><tr><td rowspan="2">x</td></tr></table>' },
        assetId: null,
        selector: null,
      },
      {
        kind: "block",
        block: { type: "paragraph", markdown: `Inline and ![kept](asset:${A}) images.` },
        assetId: null,
        selector: null,
      },
      { kind: "block", block: { type: "image", markdown: "Hero" }, assetId: B, selector: "#h" },
      { kind: "frame", index: 0 },
    ]);
  });
});

describe("verifyBlock (Q2, Q3)", () => {
  const tex = new Set(["C_6H_{12}O_6+6O_2"]);
  it("checks text against the page, math against TeX annotations", () => {
    expect(
      verifyBlock(
        { type: "paragraph", markdown: "cell divides" },
        "cell divides",
        "the cell divides twice",
        tex,
      ),
    ).toBe(true);
    expect(
      verifyBlock(
        { type: "paragraph", markdown: "cell explodes" },
        "cell explodes",
        "the cell divides",
        tex,
      ),
    ).toBe(false);
    expect(
      verifyBlock({ type: "math", markdown: "$$\nC_6H_{12}O_6 + 6O_2\n$$" }, "", "", tex),
    ).toBe(true);
    expect(verifyBlock({ type: "math", markdown: "$$\nE = mc^2\n$$" }, "", "", tex)).toBe(false);
    expect(verifyBlock({ type: "figure", markdown: "Chart" }, "", "", tex)).toBe(true);
  });
});
