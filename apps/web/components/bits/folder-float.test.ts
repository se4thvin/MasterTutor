import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FolderFloat } from "./folder-float.tsx";

describe("FolderFloat", () => {
  it("keeps the name as real text and hides the drawing", () => {
    const html = renderToStaticMarkup(
      createElement(FolderFloat, { label: "Papers", sublabel: "2 folders" }),
    );
    expect(html).toContain('<span class="ff-label">Papers</span>');
    expect(html).toContain('<span class="ff-sub">2 folders</span>');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(html).not.toContain("data-open");
  });

  it("marks open and receiving states for CSS", () => {
    const html = renderToStaticMarkup(
      createElement(FolderFloat, { label: "Papers", open: true, receiving: true }),
    );
    expect(html).toContain('data-open=""');
    expect(html).toContain('data-receive=""');
    expect(html).not.toContain("ff-sub");
  });
});
