import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockMarkdown } from "./block-markdown.tsx";
import { needsRichRendering, richPlugins } from "./rich-plugins-loader.ts";

const render = (markdown: string) =>
  renderToStaticMarkup(createElement(BlockMarkdown, { markdown }));

describe("note rendering weight (principle 2)", () => {
  it("does not import KaTeX or highlight.js eagerly", () => {
    const source = readFileSync(new URL("./block-markdown.tsx", import.meta.url), "utf8");
    const statics = source.match(/^import [^;]*;$/gms) ?? [];
    for (const heavy of [
      "rehype-katex",
      "rehype-highlight",
      "highlight-languages",
      "katex",
      "rehype-raw",
    ]) {
      expect(
        statics.some((line) => line.includes(heavy) && !line.endsWith('.css";')),
        heavy,
      ).toBe(false);
    }
  });

  it("asks for the rich plugins only when a block has math or a fenced language", () => {
    expect(needsRichRendering("Plain prose with a [link](https://x.test).")).toBe(false);
    expect(needsRichRendering("Costs `$5` inline? no: backticks only")).toBe(true);
    expect(needsRichRendering("inline $x^2$ math")).toBe(true);
    expect(needsRichRendering("$$\n\\frac{a}{b}\n$$")).toBe(true);
    expect(needsRichRendering("```python\nx = 1\n```")).toBe(true);
    expect(needsRichRendering("~~~ts\nlet x\n~~~")).toBe(true);
    // A fence with no language is never highlighted (detect: false), so it stays light.
    expect(needsRichRendering("```\nplain\n```")).toBe(false);
  });

  it("shows the sanitized plain block until the rich plugins arrive, then typesets", async () => {
    const before = render("inline $x^2$ and <script>alert(1)</script>");
    expect(before).not.toContain('class="katex"');
    expect(before).not.toContain("<script");
    await richPlugins.load();
    expect(render("inline $x^2$")).toContain('class="katex"');
  });
});
