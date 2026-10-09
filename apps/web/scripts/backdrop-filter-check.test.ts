import { describe, expect, it } from "vitest";
import { backdropFilterFindings } from "./backdrop-filter-check.ts";

describe("built CSS keeps backdrop-filter for every engine", () => {
  it("flags the minifier's merge: only the -webkit- declaration survived (Chromium drew no blur)", () => {
    const merged =
      ".glass{background:var(--glass-bg,var(--glass));-webkit-backdrop-filter:var(--blur)}";
    expect(backdropFilterFindings(merged, "a.css")).toEqual([
      "a.css: .glass has only -webkit-backdrop-filter (no blur in Chromium or Firefox)",
    ]);
  });

  it("flags a rule that lost the Safari prefix", () => {
    expect(backdropFilterFindings(".glass{backdrop-filter:var(--blur)}", "a.css")).toHaveLength(1);
  });

  it("accepts the pair, inside layers and media queries too", () => {
    const css =
      "@layer components{.glass{-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}}" +
      "@media (min-width:51rem){.x{color:red}}";
    expect(backdropFilterFindings(css, "a.css")).toEqual([]);
  });
});
