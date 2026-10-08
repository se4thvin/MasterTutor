import { describe, expect, it } from "vitest";
import { MAX_BLOCK_CHARS, escapeMarkdownText, unescapeMarkdown } from "./markdown.ts";
import { UpdateBlockInput } from "./api/dto.ts";
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
  it("lets a person save any block the agent may store (one limit, p7-0c review)", () => {
    const blockId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(
      UpdateBlockInput.safeParse({ blockId, markdown: "x".repeat(MAX_BLOCK_CHARS) }).success,
    ).toBe(true);
    expect(
      UpdateBlockInput.safeParse({ blockId, markdown: "x".repeat(MAX_BLOCK_CHARS + 1) }).success,
    ).toBe(false);
  });
});
