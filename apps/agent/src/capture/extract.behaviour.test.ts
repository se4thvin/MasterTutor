import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { pageExtract } from "./page/extract.ts";
import { pageLocateBlocks } from "./page/locate.ts";
import { preparePage } from "./prepare.ts";
import { registerClosedShadowRoots } from "./shadow.ts";
import { captureWorlds } from "./worlds.ts";

let session: BrowserSession;
const signal = new AbortController().signal;
beforeAll(async () => {
  session = await openTestSession();
});
afterAll(async () => {
  await session?.close();
});

async function extractDocs() {
  await session.goto(`${FIXTURES}/capture/docs/index.html`, signal);
  await preparePage(session, signal);
  const worlds = await captureWorlds(session);
  expect(await registerClosedShadowRoots(worlds)).toBe(1);
  const before = await session.page.content();
  const extract = await worlds.call(pageExtract, [{ scope: "page", selector: null }]);
  expect(await session.page.content()).toBe(before);
  return { worlds, extract };
}

describe("pageExtract", () => {
  it("flattens shadow DOM, tokenizes media, keeps complex tables raw and skips hidden text", async () => {
    const { extract } = await extractDocs();
    expect(extract.engine).toBe("defuddle");
    expect(extract.title).toBe("Cellular Respiration Reference");
    expect(extract.markdown).toContain("Open shadow note");
    expect(extract.markdown).toContain("Closed shadow note");
    expect(extract.markdown).not.toContain("hidden paragraph");
    expect(extract.markdown).toMatch(/```python/);
    expect(extract.markdown).toMatch(/\$\$?\s*C_6H_\{12\}O_6/);
    expect(extract.markdown).toMatch(/\| Glycolysis \| Cytoplasm \| 2 \|/);
    expect(extract.markdown).toContain("MTRAWTABLE0");
    expect(extract.rawTables[0]).toMatch(/^<table><thead><tr><th>Carrier<\/th>/);
    expect(extract.rawTables[0]).toContain('rowspan="2"');
    expect(extract.markdown).toContain("MTFRAME0");
    expect(extract.markdown).toMatch(/!\[[^\]]*\]\(https:\/\/mt-media\.invalid\/\d+\)/);
    expect(extract.frames[0]?.url).toMatch(/\/capture\/docs\/frame\.html$/);
    expect(extract.media.map((m) => [m.kind, m.figure])).toEqual(
      expect.arrayContaining([
        ["img", false],
        ["svg", true],
        ["canvas", true],
      ]),
    );
    expect(extract.media.find((m) => m.alt === "Labelled mitochondrion diagram")?.url).toMatch(
      /diagram-1200\.svg$/,
    );
    const svg = extract.media.find((m) => m.kind === "svg")?.svg ?? "";
    expect(svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain("fill:");
    expect(svg).not.toMatch(/<script|onload|javascript:/i);
    expect(extract.media.find((m) => m.kind === "canvas")?.dataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(extract.sourceText).toContain("Closed shadow note");
    expect(extract.sourceText).not.toContain("C6H12O6");
    expect(extract.sourceText).not.toContain("Glucose");
  });

  it("uses the same anchor and source order for page and element captures", async () => {
    const { worlds } = await extractDocs();
    const snippets = [{ head: "Cellular respiration converts", tail: "" }];
    const [full] = await worlds.call(pageLocateBlocks, [snippets]);
    expect(full?.selector).toBeTruthy();
    await worlds.call(pageExtract, [{ scope: "element", selector: full!.selector }]);
    const [partial] = await worlds.call(pageLocateBlocks, [snippets]);
    expect(partial).toEqual(full);
    expect(full?.domOrder?.length).toBeGreaterThan(0);
  });

  it("measures the whole page minus chrome, and collects TeX annotations", async () => {
    const { extract } = await extractDocs();
    expect(extract.pageText).toContain("Cellular respiration converts glucose");
    expect(extract.pageText).toContain("Closed shadow note");
    expect(extract.pageText).not.toContain("Fixture site footer");
    expect(extract.pageText).not.toMatch(/\bHome\b/);
    expect(extract.mathTex).toEqual(["C_6H_{12}O_6 + 6O_2 \\rightarrow 6CO_2 + 6H_2O"]);
  });

  it("locates blocks in document order with selectors and offsets", async () => {
    const { worlds } = await extractDocs();
    const located = await worlds.call(pageLocateBlocks, [
      [
        { head: "Cellular respiration converts glucose", tail: "conserved processes in biology." },
        { head: "The Krebs cycle turns twice", tail: "pool of electron carriers." },
        { head: "Closed shadow note", tail: "acceptor of the chain." },
        { head: "nonexistent text here", tail: "" },
      ],
    ]);
    expect(located[0]?.selector).toMatch(/#content > p/);
    expect(located[0]?.xpath).toMatch(/^\/html\[1\]\/body\[1\]\/article\[1\]\/p\[1\]$/);
    expect(located[1]!.domOrder!.at(-1)).toBeGreaterThan(located[0]!.domOrder!.at(-1)!);
    expect(located[0]!.start).toBe(0);
    expect(located[1]!.start).toBe(0);
    expect(located[2]).toMatchObject({ selector: null, xpath: null });
    expect(located[2]?.start).not.toBeNull();
    expect(located[3]).toEqual({ selector: null, xpath: null, start: null, end: null });
  });

  it("captures an element scope and a selection scope", async () => {
    await session.goto(`${FIXTURES}/capture/article/index.html`, signal);
    const worlds = await captureWorlds(session);
    const element = await worlds.call(pageExtract, [{ scope: "element", selector: "article ol" }]);
    expect(element.markdown).toMatch(/1\.\s+Photons excite electrons/);
    expect(element.markdown).not.toContain("Pigments do the catching");
    expect(element.pageText).toBe(element.sourceText);
    await session.page.evaluate(() => {
      const p = document.querySelectorAll("article p")[2]!;
      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 22);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    const selection = await worlds.call(pageExtract, [{ scope: "selection", selector: null }]);
    expect(selection.sourceText.trim()).toBe("Chlorophyll a and chlo");
    await expect(
      worlds.call(pageExtract, [{ scope: "element", selector: "#nope" }]),
    ).rejects.toThrow(/selector_not_found/);
  });
  it("keeps text Defuddle's content patterns would drop: it is page text and counts in coverage", async () => {
    await session.goto(`${FIXTURES}/capture/article/index.html`, signal);
    const worlds = await captureWorlds(session);
    const extract = await worlds.call(pageExtract, [{ scope: "page", selector: null }]);
    expect(extract.pageText).toContain("By A. Botanist");
    expect(extract.markdown).toContain("By A. Botanist");
  });
  it("anchors blocks anywhere in the body, not only inside Defuddle's root (5-8 review I3)", async () => {
    const { worlds } = await extractDocs();
    const [footer] = await worlds.call(pageLocateBlocks, [
      [{ head: "Fixture site footer", tail: "" }],
    ]);
    expect(footer?.selector).toMatch(/footer/);
  });

  it("flags fixed media and counts frames too small to capture (M8, M9)", async () => {
    await session.page.setContent(`
      <main><p>Fixed media and a tiny frame sit on this page with enough text to extract.</p>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="60" height="40" alt="pinned"
        style="position:fixed;top:0;left:0">
      <iframe srcdoc="<p>tiny</p>" width="80" height="40"></iframe></main>`);
    const worlds = await captureWorlds(session);
    const extract = await worlds.call(pageExtract, [{ scope: "page", selector: null }]);
    expect(extract.media.find((m) => m.alt === "pinned")?.fixed).toBe(true);
    expect(extract.smallFrames).toBe(1);
  });
  it("restores only the title h1 Defuddle dropped, as rendered text, once (re-review N1)", async () => {
    await session.page
      .setContent(`<!doctype html><html><head><title>Snake_case basics</title></head>
      <body><header><h1>Site Logo</h1></header>
      <main><article><h1>Snake_case <span style="display:none">secretly hidden</span>basics</h1>
      <p>Snake case joins words with underscores, as in total_count, and is common in Python code
      and in database column names across many projects.</p>
      <p>Most style guides pair it with lower case letters and keep constants in upper case.</p>
      </article></main></body></html>`);
    const worlds = await captureWorlds(session);
    const extract = await worlds.call(pageExtract, [{ scope: "page", selector: null }]);
    expect(extract.markdown).not.toContain("hidden");
    expect(extract.markdown).not.toContain("Site Logo");
    expect(extract.markdown.match(/Snake\\?_case basics/g)).toHaveLength(1);
  });

  it("never restores a title h1 outside the main content: a logo or an aside (QA-077)", async () => {
    const body = `<p>Our catalogue lists every gadget we stock, with prices, sizes and delivery times
      for each region we ship to, updated every morning.</p>
      <p>Orders placed before noon leave the warehouse on the same day in most regions.</p>`;
    for (const page of [
      `<div class="logo"><h1>Acme Widgets</h1></div><main><h2>Catalogue</h2>${body}</main>`,
      `<aside><h1>Acme Widgets</h1></aside><main><h2>Catalogue</h2>${body}</main>`,
      `<div id="site-logo"><h1>Acme Widgets</h1></div><div><h2>Catalogue</h2>${body}</div>`,
    ]) {
      await session.page.setContent(
        `<!doctype html><html><head><title>Acme Widgets</title></head><body>${page}</body></html>`,
      );
      const worlds = await captureWorlds(session);
      const extract = await worlds.call(pageExtract, [{ scope: "page", selector: null }]);
      expect(extract.markdown).toContain("Orders placed before noon");
      expect(extract.markdown).not.toContain("# Acme Widgets");
    }
  });

  describe("an interactive-textbook section (app shell, activities)", () => {
    async function extractTextbook() {
      await session.goto(`${FIXTURES}/capture/textbook/index.html`, signal);
      await preparePage(session, signal);
      await session.page.evaluate(() => document.fonts.ready);
      const worlds = await captureWorlds(session);
      return worlds.call(pageExtract, [{ scope: "page", selector: null }]);
    }

    it("drops ligature icons everywhere, and the app UI above the heading from the note only", async () => {
      const extract = await extractTextbook();
      // Drawn as single glyphs by the page's ligature font (no "icon" in its name): not text.
      for (const glyph of ["expand_more", "expand_less", "thumb_up", "thumb_down"])
        for (const field of [extract.markdown, extract.pageText])
          expect(field).not.toContain(glyph);
      // The assignment box leaves the note but still counts: nothing proves it is not content.
      for (const text of ["Students:", "Due: 03/14/2031", "Activities:"]) {
        expect(extract.markdown).not.toContain(text);
        expect(extract.pageText).toContain(text);
        expect(extract.excludedText).toContain(text);
      }
      expect(extract.markdown).toMatch(/^#+ 2\.3 Parity bits$/m);
      expect(extract.markdown).toContain("With even parity, the sender picks the extra bit");
    });

    it("keeps a drawing of positioned text as one element picture, not its labels", async () => {
      const extract = await extractTextbook();
      const drawings = extract.media.filter((m) => m.kind === "element");
      expect(drawings).toHaveLength(1);
      expect(drawings[0]).toMatchObject({ figure: true, rect: expect.any(Object) });
      for (const field of [extract.markdown, extract.pageText])
        expect(field).not.toMatch(/^ones:$/m);
      // A control's label is page text, and the note keeps it.
      expect(extract.markdown).toContain("2x speed");
      // The screen-reader description beside it is text, and stays.
      expect(extract.markdown).toContain("Static figure: Step 1: Count the ones in 1011");
    });

    it("renders each activity as one quote: placeholder, label, bold title, numbered prompts, options", async () => {
      const extract = await extractTextbook();
      expect(extract.activities.map((a) => a.title)).toEqual([
        "2.3.1: Computing an even parity bit.",
        "2.3.2: Even parity.",
        "2.3.3: Parity checks.",
      ]);
      expect(extract.activities.every((a) => a.url?.endsWith("/capture/textbook/index.html"))).toBe(
        true,
      );
      const quoted = extract.markdown.split("\n").filter((line) => line.startsWith(">"));
      expect(extract.activityToken).toMatch(/^MTACTIVITY[0-9a-f]{16}N$/);
      const third = quoted.slice(
        quoted.findIndex((line) => line === `> ${extract.activityToken}2`),
      );
      expect(third).toEqual(
        expect.arrayContaining([
          "> participation activity",
          "> **2.3.3: Parity checks.**",
          "> 10010 shows an error.",
          "> - True",
          "> - False",
        ]),
      );
      expect(quoted).toContain("> 1)");
      expect(extract.markdown).not.toMatch(/^#+ 2\.3\.\d/m);
      expect(extract.markdown).toMatch(/^#+ Detecting errors$/m);
    });

    it("keeps the words of a body font whose name contains 'icon' (review I3)", async () => {
      await session.goto(`${FIXTURES}/capture/probes/font.html`, signal);
      const worlds = await captureWorlds(session);
      const extract = await worlds.call(pageExtract, [{ scope: "page", selector: null }]);
      expect(extract.markdown).toMatch(/^#+ Sediment$/m);
      expect(extract.markdown).toContain("the *grain* size");
      expect(extract.markdown).toContain("[settles](#x)");
      expect(extract.pageText).toContain("Sediment");
    });

    it("keeps MathJax 2 TeX and table captions", async () => {
      const extract = await extractTextbook();
      expect(extract.mathTex).toContain("p = d_1 \\oplus d_2 \\oplus \\cdots \\oplus d_n");
      expect(extract.markdown).toContain("$p = d_1 \\oplus d_2 \\oplus \\cdots \\oplus d_n$");
      expect(extract.markdown).toMatch(
        /Table 2\.3\.1: Even parity bits for three data bits\.\n\n\| Data \| Parity bit \|/,
      );
    });
  });
});
