import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const library = readFileSync(new URL("./library.css", import.meta.url), "utf8");
const tree = readFileSync(
  new URL("../components/library/folder-tree.tsx", import.meta.url),
  "utf8",
);
const palette = readFileSync(
  new URL("../components/library/search-palette.tsx", import.meta.url),
  "utf8",
);
const view = readFileSync(
  new URL("../components/library/library-view.tsx", import.meta.url),
  "utf8",
);

/** State changes move rather than cut (M4, spec §11.4); transform and opacity only. */
describe("Daylight motion on state changes", () => {
  it("the tree disclosure rotates one chevron instead of swapping glyphs", () => {
    expect(tree).not.toMatch(/"chevronDown"\s*:\s*"chevronRight"/);
    expect(library).toMatch(/\.tree-disclosure[\s\S]*?transition-property:\s*rotate/);
    expect(library).toMatch(/\[data-open\][^{]*\{[^}]*rotate:\s*90deg/);
  });

  it("a newly shown subtree row eases in", () => {
    expect(library).toMatch(
      /\.tree-row\[aria-level\]:not\(\[aria-level="1"\]\)[^{]*\{[^}]*animation-name:\s*tree-reveal/,
    );
    expect(library).toMatch(/@keyframes tree-reveal/);
  });

  it("the palette selection is one highlight that glides between rows", () => {
    expect(palette).toMatch(/layoutId="palette-hit"/);
    expect(palette).toMatch(/<LayoutMotion>/);
    expect(library).toMatch(/\.hit-highlight\s*\{/);
    expect(library).not.toMatch(/@keyframes hit-select/);
  });

  it("palette results ease in on a short stagger", () => {
    expect(library).toMatch(/\.palette \.hit[^{]*\{[^}]*animation-name:\s*hit-in/);
    expect(library).toMatch(/@keyframes hit-in/);
  });

  it("removed note cards exit through AnimatePresence", () => {
    expect(view).toMatch(/<AnimatePresence[^>]*initial=\{false\}/);
    expect(view).toMatch(/exit=\{/);
  });
});
