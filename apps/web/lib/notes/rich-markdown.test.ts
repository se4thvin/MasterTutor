import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createSeed } from "../fixtures/seed.ts";
import {
  RAW_BLOCK_TYPES,
  editsAsRichText,
  richTextKit,
  roundTripsRichText,
} from "./rich-markdown.ts";

/** Each case either survives parse→serialize byte for byte, or must fall back to the raw editor. */
const CASES: Array<[name: string, markdown: string, rich: boolean]> = [
  ["heading", "## The update rule", true],
  ["paragraph with marks and a link", "A **bold**, *em*, `code` and [link](https://x.test).", true],
  ["bullet list", "- one\n- two", true],
  ["ordered list", "1. one\n2. two", true],
  ["nested list", "- a\n  - nested\n- b", true],
  ["quote", "> Every large run uses warmup.", true],
  ["soft line break", "line one\nline two", true],
  ["task list", "- [ ] task\n- [x] done", false],
  ["inline math", "inline $\\alpha_t = 0.9$ math", false],
  ["footnote reference", "a claim[^1]", false],
  ["inline HTML (kbd)", "press <kbd>Ctrl</kbd>", false],
  ["underscore emphasis", "Para _x_ here", false],
  ["star list marker", "* a\n* b", false],
  ["paren list marker", "1) one", false],
  ["trailing newline", "text\n", false],
  ["underline syntax is plain text", "x ++u++ y", true],
  ["commentary prose", "The author skips the bias-correction step; see **Adam** §2.", true],
  ["commentary with inline math", "Warmup keeps $\\eta_t$ small early.", false],
];

describe("rich-text editing is offered only when it is byte-faithful", () => {
  it.each(CASES)("%s", (_name, markdown, rich) => {
    expect(roundTripsRichText(markdown)).toBe(rich);
  });

  it("has no underline mark: its ++x++ is not GFM and the reader would not render it", () => {
    expect(getSchema([richTextKit]).marks["underline"]).toBeUndefined();
  });

  it("never offers rich editing for raw block types", () => {
    for (const type of RAW_BLOCK_TYPES) {
      expect(editsAsRichText({ type, markdown: "plain" }), type).toBe(false);
    }
  });

  it("offers rich editing for commentary exactly when its Markdown round-trips", () => {
    expect(editsAsRichText({ type: "commentary", markdown: "A plain aside." })).toBe(true);
    expect(editsAsRichText({ type: "commentary", markdown: "A claim[^1]" })).toBe(false);
  });

  it("keeps plain fixture prose on the rich editor", () => {
    const [warmup] = createSeed().notes;
    const prose = warmup?.blocks.filter((b) => b.type === "paragraph" || b.type === "heading");
    expect(prose?.length).toBeGreaterThan(0);
    for (const block of prose ?? []) expect(editsAsRichText(block), block.markdown).toBe(true);
  });
});
