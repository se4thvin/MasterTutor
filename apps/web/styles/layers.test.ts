import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Top-level statements of a stylesheet: [prelude, hasBlock]. Comments are stripped first. */
function topLevel(css: string): string[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      if (depth === 0) found.push(src.slice(start, i).trim());
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (ch === ";" && depth === 0) start = i + 1;
  }
  return found;
}

describe("base.css layering", () => {
  const css = readFileSync(new URL("./base.css", import.meta.url), "utf8");

  it("keeps every rule inside @layer base or @layer components", () => {
    const blocks = topLevel(css);
    expect(blocks.length).toBeGreaterThan(0);
    for (const prelude of blocks) expect(prelude).toMatch(/^@layer (base|components)$/);
  });

  it("does not reshape elements on focus", () => {
    const focus = /:focus-visible\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(focus).toContain("outline");
    expect(focus).not.toContain("border-radius");
  });
});
