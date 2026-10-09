import { describe, expect, it } from "vitest";
import { escapeMarkdownText } from "@mastertutor/contracts";
import {
  activityCallout,
  blockPlainText,
  joinEnumerators,
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

describe("joinEnumerators", () => {
  it("joins a question number on its own line to the line it numbers, in prose and in quotes", () => {
    expect(joinEnumerators("1)\n\nWhat is 2 + 2?\n\n2.\nNext one")).toBe(
      "1\\) What is 2 + 2?\n\n2\\. Next one",
    );
    expect(joinEnumerators("> intro\n>\n> 1)\n>\n> What is 2 + 2?")).toBe(
      "> intro\n>\n> 1\\) What is 2 + 2?",
    );
  });
  it("keeps the number as verifiable text", () => {
    expect(blockPlainText({ type: "paragraph", markdown: joinEnumerators("1)\n\nWhat?") })).toBe(
      "1) What?",
    );
  });
  it("never touches fenced code, quoted or not", () => {
    for (const text of ["```\n1.\n\nx = 1\n```", "> ~~~\n> 2)\n> y\n> ~~~"])
      expect(joinEnumerators(text)).toBe(text);
    expect(joinEnumerators("```\n1.\n```\n\n1)\n\nAfter")).toBe("```\n1.\n```\n\n1\\) After");
  });
  it("leaves a number before structure, at the end, or across a quote boundary", () => {
    for (const text of ["1)\n\n# Heading", "1)\n\n- item", "text\n\n3)", "> 1)\n\nOutside"])
      expect(joinEnumerators(text)).toBe(text);
  });
});

describe("activity callouts", () => {
  const header = `> ${activityCallout("https://book.test/s/4#:~:text=4.4.2")}`;
  it("builds an Obsidian callout title that links back, escaping link-breaking characters", () => {
    expect(header).toBe("> [!example] [Interactive activity](https://book.test/s/4#:~:text=4.4.2)");
    expect(activityCallout("https://book.test/a (b)")).toBe(
      "[!example] [Interactive activity](https://book.test/a%20%28b%29)",
    );
    expect(activityCallout(null)).toBe("[!example] Interactive activity");
  });
  it("keeps the header out of the block's plain text, so only page text is verified", () => {
    const markdown = `${header}\n>\n> participation activity\n>\n> **4.4.2: Overflow.**`;
    expect(blockPlainText({ type: "quote", markdown })).toBe(
      "participation activity 4.4.2: Overflow.",
    );
    expect(blockPlainText({ type: "quote", markdown: "> [!example] Interactive activity" })).toBe(
      "",
    );
  });
  it("never exempts the same words written by a page (escaped) or outside a quote's first line", () => {
    expect(
      blockPlainText({ type: "quote", markdown: "> \\[!example\\] Interactive activity" }),
    ).toBe("[!example] Interactive activity");
    expect(
      blockPlainText({ type: "quote", markdown: "> text\n> [!example] Interactive activity" }),
    ).toBe("text [!example] Interactive activity");
    expect(blockPlainText({ type: "paragraph", markdown: "[!example] Interactive activity" })).toBe(
      "[!example] Interactive activity",
    );
  });
});
