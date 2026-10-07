import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FolderMark } from "./folder-mark.tsx";

describe("FolderMark", () => {
  it("is decorative and stacks a closed and an open glyph", () => {
    const html = renderToStaticMarkup(createElement(FolderMark, { name: "folder" }));
    expect(html).toMatch(/^<span class="fmark" aria-hidden="true">/);
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).toContain("fmark-shut");
    expect(html).toContain("fmark-open");
    expect(html).not.toContain("data-lift");
  });

  it("marks the lid lifted", () => {
    const html = renderToStaticMarkup(createElement(FolderMark, { name: "folder", lift: true }));
    expect(html).toContain('data-lift=""');
  });

  it("has no lid when there is no open glyph (All notes, Unfiled)", () => {
    const html = renderToStaticMarkup(
      createElement(FolderMark, { name: "unfiled", openName: null }),
    );
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("keeps a lid-less glyph when lifted (I1: Unfiled and Top level take drops too)", () => {
    const html = renderToStaticMarkup(
      createElement(FolderMark, { name: "unfiled", openName: null, lift: true }),
    );
    expect(html).toContain('data-lift=""');
    expect(html).toContain("fmark-shut");
    expect(html).not.toContain("fmark-open");
  });
});
