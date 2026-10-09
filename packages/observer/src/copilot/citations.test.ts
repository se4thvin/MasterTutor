import { describe, expect, it } from "vitest";
import { checkCitations } from "./citations.ts";

describe("citations (spec §7.6)", () => {
  it("keeps markers that match a stored result and removes invented ones", () => {
    const result = checkCitations("Spend was $4 [Q1], errors rose [Q7].", new Set(["Q1", "Q2"]));
    expect(result).toEqual({
      text: "Spend was $4 [Q1], errors rose.",
      citations: ["Q1"],
      removed: ["Q7"],
    });
  });
});
