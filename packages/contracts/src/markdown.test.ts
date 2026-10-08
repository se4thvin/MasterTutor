import { describe, expect, it } from "vitest";
import { MAX_BLOCK_CHARS, escapeMarkdownText, unescapeMarkdown } from "./markdown.ts";
import { NoteBlock } from "./note.ts";

describe("Markdown escapes (one set for writer, verifier and notes)", () => {
  it("unescapes everything escapeMarkdownText escapes, angle brackets included", () => {
    const text = "a*b_c [d] <e> `f` \\g # h";
    expect(unescapeMarkdown(escapeMarkdownText(text))).toBe(text);
    expect(unescapeMarkdown("\\<b\\> \\$5 \\| x")).toBe("<b> $5 | x");
  });
  it("bounds blocks with the NoteBlock contract's own limit", () => {
    expect(NoteBlock.shape.markdown.maxLength).toBe(MAX_BLOCK_CHARS);
  });
});
