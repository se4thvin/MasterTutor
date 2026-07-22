import { describe, expect, it } from "vitest";
import { sha256Hex } from "../notes/hash.ts";
import {
  blockPrecision,
  combineCoverage,
  coverageOf,
  mergeReferences,
  normalizeText,
  tokens,
} from "./text.ts";

describe("normalizeText", () => {
  it("applies NFKC, strips invisible characters and straightens quotes", () => {
    expect(normalizeText("ﬁ\u00ADne\u200B “quoted”  ‘x’\n\tend")).toBe(`fine "quoted" 'x' end`);
    expect(tokens("Don't stop—ATP!")).toEqual(["don", "t", "stop", "atp"]);
  });
  it("keeps combining marks inside words (review I1)", () => {
    expect(tokens("हिन्दी भाषा")).toEqual(["हिन्दी", "भाषा"]);
    expect(tokens("ภาษาไทย ดี")).toEqual(["ภาษาไทย", "ดี"]);
    // A rewrite of a Hindi sentence no longer matches as a bag of single letters.
    expect(blockPrecision("दिन", "हिन्दी")).toBe(0);
  });
  it("separates super- and subscript digits so markup and the rendered page agree", () => {
    expect(tokens("10²")).toEqual(tokens("10 2"));
    expect(tokens("H₂O")).toEqual(["h", "2", "o"]);
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

describe("mergeReferences", () => {
  it("keeps each token's larger count, never the sum (5-8 review M3)", () => {
    const merged = mergeReferences(["cell cell divides", "cell divides divides"]);
    expect(coverageOf("cell cell cell", merged).coverage).toBeCloseTo(2 / 3);
    expect(coverageOf("divides divides", merged).coverage).toBe(1);
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
