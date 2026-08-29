import { describe, expect, it } from "vitest";
import {
  chapterBlocks,
  chaptersFromDescription,
  chaptersFromInitialData,
  extractInitialData,
} from "./chapters.ts";

describe("chapters", () => {
  it("reads chapterRenderer and macro markers from ytInitialData", () => {
    const script =
      'var ytInitialData = {"a":{"chapterRenderer":{"title":{"simpleText":"Intro"},"timeRangeStartMillis":0}},"b":[{"chapterRenderer":{"title":{"simpleText":"Body } with brace"},"timeRangeStartMillis":65000}}],"c":{"macroMarkersListItemRenderer":{"title":{"runs":[{"text":"End"}]},"timeDescription":"2:00"}}};var other = 1;';
    expect(chaptersFromInitialData(extractInitialData(script))).toEqual([
      { title: "Intro", start: 0 },
      { title: "Body } with brace", start: 65 },
      { title: "End", start: 120 },
    ]);
    expect(extractInitialData("var nothing = 1")).toBeNull();
  });
  it("falls back to description timestamps only when they form a chapter list", () => {
    expect(
      chaptersFromDescription("Intro text\n0:00 Intro\n0:05 Light reactions\n1:02:03 - Late"),
    ).toEqual([
      { title: "Intro", start: 0 },
      { title: "Light reactions", start: 5 },
      { title: "Late", start: 3_723 },
    ]);
    expect(chaptersFromDescription("0:10 a\n0:20 b\n0:30 c")).toEqual([]);
    expect(chaptersFromDescription("0:00 a\n0:20 b")).toEqual([]);
  });
  it("makes heading blocks for chapters not yet in the note", () => {
    const blocks = chapterBlocks(
      [
        { title: "Intro", start: 0 },
        { title: "Next", start: 5 },
      ],
      new Set([0]),
    );
    expect(blocks).toEqual([
      expect.objectContaining({
        type: "heading",
        markdown: "## Next",
        origin: "dom",
        anchor: expect.objectContaining({ tStart: 5 }),
      }),
    ]);
  });
});
