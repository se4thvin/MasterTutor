// re-review m7: the read_page element cap lives in one place (contracts); the tool, its description
// for the model and the grading prompt all derive from it.
import { readFileSync } from "node:fs";
import { READ_PAGE_MAX_ELEMENTS } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { discoveryInstruction } from "./suites/prompts.ts";

const source = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("the read_page element cap (one source)", () => {
  it("is defined once, in contracts, and written nowhere else", () => {
    expect(READ_PAGE_MAX_ELEMENTS).toBe(400);
    for (const path of [
      "apps/agent/src/tools/read-page.ts",
      "apps/agent/src/llm/tools.ts",
      "tests/bench/src/suites/prompts.ts",
    ])
      expect(source(path), path).not.toMatch(/\b400\b/);
  });
  it("drives the grading prompt's paging offsets", () => {
    const n = READ_PAGE_MAX_ELEMENTS;
    expect(discoveryInstruction("https://x.test", [1])).toContain(`offset 0, ${n}, ${2 * n}`);
  });
});
