import { describe, expect, it } from "vitest";
import { MAX_UNTRUSTED, untrustedText } from "./untrusted-text.ts";

describe("untrustedText (S6)", () => {
  it("strips bidi overrides, isolates and zero-width characters", () => {
    expect(untrustedText("\u202Egpj.exe")).toBe("gpj.exe");
    expect(untrustedText("a\u200Bb\u2066c\u2069d\uFEFF")).toBe("abcd");
  });

  it("turns control characters and runs of whitespace into single spaces", () => {
    expect(untrustedText("  line\none\ttab\u0000end  ")).toBe("line one tab end");
  });

  it("folds compatibility forms (NFKC)", () => {
    expect(untrustedText("\uFB01le \uFF21")).toBe("file A");
  });

  it("caps by code point, never splitting a surrogate pair", () => {
    const capped = untrustedText("😀".repeat(500), 10);
    expect([...capped]).toHaveLength(10);
    expect(capped.endsWith("…")).toBe(true);
    expect(untrustedText("x".repeat(2_000)).length).toBe(MAX_UNTRUSTED);
  });

  it("returns an empty string for nothing", () => {
    expect(untrustedText(null)).toBe("");
    expect(untrustedText(undefined)).toBe("");
    expect(untrustedText("\u200B")).toBe("");
  });

  it("strips invisible fillers that are not format characters (Hangul fillers, braille blank)", () => {
    expect(untrustedText("a\u115Fb\u1160c\u3164d\uFFA0e\u2800f")).toBe("abcdef");
  });

  it("caps runs of combining marks so a label cannot tower over the line", () => {
    // "x" has no precomposed accented form, so NFKC leaves every mark in place.
    const zalgo = "x" + "\u0301".repeat(50) + "b";
    expect(untrustedText(zalgo)).toBe("x" + "\u0301".repeat(4) + "b");
  });
});
