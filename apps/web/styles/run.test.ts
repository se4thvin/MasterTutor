import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const run = readFileSync(new URL("./run.css", import.meta.url), "utf8");

describe("run.css motion", () => {
  it("keeps a brief opacity fade for the click ring under reduced motion (no scale)", () => {
    const reduce =
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.acur-pulse \{([^}]*@starting-style \{[^}]*\}[^}]*)\}/.exec(
        run,
      )?.[1];
    expect(reduce).toBeDefined();
    expect(reduce).toMatch(/animation-name:\s*none/);
    expect(reduce).toMatch(/transition-property:\s*opacity/);
    expect(reduce).toMatch(/@starting-style \{\s*opacity:\s*0\.35;/);
  });
});
