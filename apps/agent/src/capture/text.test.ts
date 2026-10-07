import { describe, expect, it } from "vitest";
import { sha256Hex } from "../notes/hash.ts";
import { blockPrecision, combineCoverage, coverageOf, normalizeText, tokens } from "./text.ts";

describe("normalizeText", () => {
  it("applies NFKC, strips invisible characters and straightens quotes", () => {
    expect(normalizeText("ﬁ\u00ADne\u200B “quoted”  ‘x’\n\tend")).toBe(`fine "quoted" 'x' end`);
    expect(tokens("Don't stop—ATP₂!")).toEqual(["don", "t", "stop", "atp2"]);
  });
});

describe("coverageOf", () => {
  it("counts source tokens present in the capture (multiset)", () => {
    const c = coverageOf("the cell the cell divides", "The cell divides");
    expect(c).toEqual({ coverage: 3 / 5, sourceTokens: 5, matchedTokens: 3 });
    expect(coverageOf("", "anything").coverage).toBe(1);
  });
  it("combines parts by token totals", () => {
    expect(
      combineCoverage([
        { coverage: 1, sourceTokens: 10, matchedTokens: 10 },
        { coverage: 0, sourceTokens: 10, matchedTokens: 0 },
      ]).coverage,
    ).toBe(0.5);
  });
  it("measures block precision against the source", () => {
    expect(blockPrecision("cell divides", "the cell divides twice")).toBe(1);
    expect(blockPrecision("cell explodes", "the cell divides")).toBe(0.5);
  });
});

describe("sha256Hex", () => {
  it("hashes strings and bytes alike", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
  });
});
