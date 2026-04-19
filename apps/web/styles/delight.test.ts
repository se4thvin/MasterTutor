import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const library = read("./library.css");
const shell = read("./shell.css");

/** Group B review fixes (D43 delight pass) that live in stylesheets and sources. */
describe("delight pass: move sheet, run badge and palette details", () => {
  it("the receive pill appears quickly, then dives in (m-3)", () => {
    expect(library).toMatch(
      /\.move-pill\s*\{[^}]*animation-name:\s*pill-dive, pill-appear;[^}]*animation-timing-function:\s*var\(--motion-ease-in\), var\(--motion-ease-out\);/,
    );
  });

  it("the sidebar live dot keeps its 0.45rem size (m-4, D25)", () => {
    expect(shell).toMatch(/\.nav-meta \.smark\s*\{\s*--smark-size:\s*1\.2rem;/);
  });

  it("a palette result is styled in one block (m-9)", () => {
    // Not counting the shared `.hit-link, .palette .hit` list.
    expect(library.match(/(?<!,)\n\s*\.palette \.hit \{/g)).toHaveLength(1);
  });

  it("the toast documents its countdown fuse under reduced motion (m-5)", () => {
    expect(read("../components/bits/swipe-toast.tsx").slice(0, 2000)).toMatch(
      /countdown fuse[^.]*reduced motion/i,
    );
  });

  it("a reopened move sheet starts fresh: the pick list is keyed by the item (m-7)", () => {
    expect(read("../components/library/move-sheet.tsx")).toMatch(/<FolderPickList\s+key=\{note/);
    expect(read("../components/library/folder-move-sheet.tsx")).toMatch(
      /<FolderPickList\s+key=\{folder/,
    );
  });
});
