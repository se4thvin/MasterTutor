import { describe, expect, it } from "vitest";
import { Anchor, NoteBlock } from "./note.ts";

const domAnchor = {
  selector: "main > p:nth-of-type(2)",
  xpath: "/html/body/main/p[2]",
  start: 0,
  end: 120,
  textFragment: "#:~:text=Photosynthesis",
};

describe("Anchor", () => {
  it("accepts DOM, PDF and video anchors", () => {
    expect(Anchor.safeParse(domAnchor).success).toBe(true);
    expect(
      Anchor.safeParse({ ...domAnchor, page: 3, bbox: { x: 1, y: 2, width: 3, height: 4 } })
        .success,
    ).toBe(true);
    expect(
      Anchor.safeParse({
        selector: null,
        xpath: null,
        start: null,
        end: null,
        textFragment: null,
        tStart: 12.5,
        tEnd: 20,
      }).success,
    ).toBe(true);
  });
  it("rejects inverted ranges", () => {
    expect(Anchor.safeParse({ ...domAnchor, start: 10, end: 5 }).success).toBe(false);
    expect(
      Anchor.safeParse({
        selector: null,
        xpath: null,
        start: null,
        end: null,
        textFragment: null,
        tStart: 30,
        tEnd: 10,
      }).success,
    ).toBe(false);
  });
});

describe("NoteBlock", () => {
  it("parses a captured block", () => {
    const block = {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      noteId: "6f9619ff-8b86-4d01-b42d-00c04fc964ff",
      position: "a0",
      type: "paragraph",
      markdown: "Plants convert light into chemical energy.",
      assetId: null,
      sourceId: null,
      origin: "dom",
      anchor: domAnchor,
      contentSha256: "a".repeat(64),
      verified: true,
      edited: false,
      originalMarkdown: null,
      createdAt: "2026-10-05T12:00:00.000Z",
    };
    expect(NoteBlock.parse(block).type).toBe("paragraph");
    expect(NoteBlock.safeParse({ ...block, origin: "llm" }).success).toBe(false);
  });
});
