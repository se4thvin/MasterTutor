import { describe, expect, it } from "vitest";
import { escapeMarkdownText } from "@mastertutor/contracts";
import {
  blockPlainText,
  limitBlockSize,
  splitMarkdown,
  texOf,
  textToMarkdown,
} from "./markdown-blocks.ts";

const md = [
  "# Title",
  "",
  "Intro with **bold**, a [link](https://x.test) and $E=mc^2$ costs $5 and $10.",
  "Second line of the same paragraph.",
  "",
  "- one",
  "- two",
  "  continued",
  "",
  "1. first",
  "",
  "> quoted",
  "> more",
  "",
  "```python",
  "def f():",
  "",
  "    return 1",
  "```",
  "",
  "$$",
  "C_6H_{12}O_6",
  "$$",
  "",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  '<table><tr><td rowspan="2">x</td></tr>',
  "<tr><td>y</td></tr></table>",
  "",
  "![Alt](https://mt-media.invalid/0)",
].join("\n");

describe("splitMarkdown", () => {
  it("splits every block type", () => {
    expect(splitMarkdown(md).map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "code",
      "math",
      "table",
      "table",
      "image",
    ]);
    expect(splitMarkdown(md)[5]!.markdown).toBe("```python\ndef f():\n\n    return 1\n```");
  });
});

describe("blockPlainText", () => {
  it("keeps visible text and drops syntax, math and image alt", () => {
    const [heading, paragraph, list] = splitMarkdown(md);
    expect(blockPlainText(heading!)).toBe("Title");
    expect(blockPlainText(paragraph!)).toBe(
      "Intro with bold , a link and costs $5 and $10. Second line of the same paragraph.",
    );
    expect(blockPlainText(list!)).toBe("one two continued");
    expect(blockPlainText(splitMarkdown(md).at(-1)!)).toBe("");
  });
  it("strips only real tags: comparisons and escaped brackets stay visible (review I2)", () => {
    const p = (markdown: string) => blockPlainText({ type: "paragraph", markdown });
    expect(p("If 3 < 4 and 5 > 2 then done")).toBe("If 3 < 4 and 5 > 2 then done");
    expect(p("Use \\<div\\> for blocks")).toBe("Use <div> for blocks");
    expect(p("x &lt; y and a<sub>2</sub>")).toBe("x < y and a 2");
    // Every escape escapeMarkdownText writes is undone (one shared set).
    const text = "a*b_c [d] <e> `f` \\g";
    expect(p(escapeMarkdownText(text))).toBe(text.replace(/[*_`]/g, " ").replace(/\s+/g, " "));
  });
  it("reads $…$ in prose as inline math (accepted heuristic: lowers coverage, never raises it)", () => {
    expect(blockPlainText({ type: "paragraph", markdown: "pay $a and b$ now" })).toBe("pay now");
  });
});

describe("limitBlockSize", () => {
  it("splits oversize code blocks and re-fences each part", () => {
    const body = Array.from({ length: 4 }, (_, i) => `line ${i} ${"x".repeat(60)}`).join("\n");
    const parts = limitBlockSize({ type: "code", markdown: "```js\n" + body + "\n```" }, 150);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.markdown.startsWith("```js\n")).toBe(true);
      expect(part.markdown.endsWith("\n```")).toBe(true);
      expect(part.markdown.length).toBeLessThanOrEqual(150);
    }
  });
});

describe("textToMarkdown", () => {
  it("escapes Markdown syntax in plain text", () => {
    expect(textToMarkdown("# not heading\n\n- not list *x*")).toBe(
      "\\# not heading\n\n\\- not list \\*x\\*",
    );
  });
});

describe("media and math blocks", () => {
  it("carry no comparable plain text, and math exposes its TeX", () => {
    for (const type of ["image", "figure", "keyframe", "math"])
      expect(blockPlainText({ type, markdown: "Caption text" })).toBe("");
    expect(texOf("$$\nC_6H_{12}O_6 + 6O_2\n$$")).toBe("C_6H_{12}O_6+6O_2");
    expect(texOf("plain")).toBeNull();
  });
});
