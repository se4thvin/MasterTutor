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
  activities: [],
  activityToken: "MTACTIVITYf00dN",
  excludedText: "",
  frames: [{ index: 0, url: "https://x.test/f", name: null }],
  smallFrames: 0,
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
      fixed: false,
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
      fixed: false,
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
      fixed: false,
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
      fixed: false,
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

describe("assembleBlocks: interactive activities", () => {
  const activity = (url: string | null): PageExtract => ({
    ...extract,
    markdown: [
      "1)",
      "",
      "A numbered prose line.",
      "",
      "> MTACTIVITYf00dN0",
      ">",
      "> participation activity",
      ">",
      "> **4.4.2: Overflow.**",
      ">",
      "> 1)",
      ">",
      "> 0011 + 0010 results in overflow.",
      ">",
      "> - True",
      "> - False",
    ].join("\n"),
    media: [],
    activities: [{ title: "4.4.2: Overflow.", url }],
  });
  const markdownOf = (page: PageExtract) =>
    assembleBlocks(page, new Map()).map((b) => (b.kind === "block" ? b.block : b));

  it("turns the placeholder into a callout header linking to the activity's title on its page", () => {
    expect(markdownOf(activity("https://book.test/ch/4"))).toEqual([
      { type: "paragraph", markdown: "1\\) A numbered prose line." },
      {
        type: "quote",
        markdown: [
          "> [!example] [Interactive activity](https://book.test/ch/4#:~:text=4.4.2%3A%20Overflow.)",
          ">",
          "> participation activity",
          ">",
          "> **4.4.2: Overflow.**",
          ">",
          "> 1\\) 0011 + 0010 results in overflow.",
          ">",
          "> - True",
          "> - False",
        ].join("\n"),
      },
    ]);
  });

  it("resolves a placeholder nested in a list or quote, and never one without this capture's token", () => {
    const page: PageExtract = {
      ...activity("https://book.test/ch/4"),
      markdown: "- > MTACTIVITYf00dN0\n\n> > MTACTIVITYf00dN0\n\n> MTACTIVITY0",
    };
    expect(markdownOf(page).map((b) => ("markdown" in b ? b.markdown : ""))).toEqual([
      expect.stringMatching(
        /^- > \[!example\] \[Interactive activity\]\(https:\/\/book\.test\/ch\/4#/,
      ),
      expect.stringMatching(/^> > \[!example\] \[Interactive activity\]\(/),
      "> MTACTIVITY0",
    ]);
  });

  it("writes no link when the page has no web address", () => {
    const [, callout] = markdownOf(activity(null));
    expect(callout).toMatchObject({
      markdown: expect.stringMatching(/^> \[!example\] Interactive activity\n/),
    });
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
