import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockMarkdown } from "./block-markdown.tsx";

const render = (markdown: string, allowHtml = false) =>
  renderToStaticMarkup(createElement(BlockMarkdown, { markdown, allowHtml }));

describe("BlockMarkdown on untrusted page content", () => {
  it("strips scripts, handlers and javascript: URLs even in raw-HTML tables", () => {
    const html = render(
      '<table onclick="steal()"><tr><td><script>alert(1)</script><img src=x onerror=alert(1)>a</td></tr></table>',
      true,
    );
    expect(html).not.toMatch(/<script|onerror|onclick/i);
    expect(html).not.toContain("<img");
    expect(render("[x](javascript:alert(1))")).not.toContain('href="javascript');
    expect(
      render('<table><tr><td><a href="javascript:alert(1)">x</a></td></tr></table>', true),
    ).not.toMatch(/href="javascript/i);
  });

  it("never loads third-party images", () => {
    const html = render("![tracker](https://evil.example/pixel.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("Image: tracker");
  });

  it("never loads images from raw-HTML tables or data: / asset: URLs either", () => {
    for (const src of ["https://evil.example/p.png", "data:image/png;base64,AAAA", "asset:abc"]) {
      const html = render(`<table><tr><td><img src="${src}" alt="x"></td></tr></table>`, true);
      expect(html).not.toContain("<img");
      expect(html).not.toContain("src=");
    }
  });

  it("opens links safely in a new tab", () => {
    expect(render("[docs](https://example.com)")).toContain('rel="noopener noreferrer"');
  });

  it("keeps rowspan/colspan in captured HTML tables", () => {
    expect(render('<table><tr><td rowspan="2">A</td></tr></table>', true).toLowerCase()).toContain(
      'rowspan="2"',
    );
  });

  it("ignores raw HTML outside table blocks", () => {
    expect(render("<b>bold</b> text")).not.toContain("<b>");
  });

  it("typesets display and inline math with KaTeX", () => {
    expect(render("$$\n\\frac{a}{b}\n$$")).toContain("katex-display");
    expect(render("inline $x^2$")).toContain('class="katex"');
  });

  it("does not let KaTeX trust links or raw HTML in math", () => {
    const html = render("$\\href{javascript:alert(1)}{x}$");
    expect(html).not.toMatch(/href="javascript/i);
  });

  it("highlights fenced code by language and keeps unknown languages plain", () => {
    expect(render("```python\ndef f(): return 1\n```")).toContain("hljs-keyword");
    expect(render("```cobol\nDISPLAY 'HI'\n```")).toContain("DISPLAY");
  });

  it("renders GFM tables", () => {
    expect(render("| a | b |\n| - | - |\n| 1 | 2 |")).toContain("<table>");
  });
});
