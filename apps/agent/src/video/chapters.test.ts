import { describe, expect, it } from "vitest";
import {
  chapterBlocks,
  chaptersFor,
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
      true,
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
  it("uses ytInitialData chapters only for the video on screen (SPA navigation)", () => {
    const script = (id: string) =>
      `var ytInitialData = {"currentVideoEndpoint":{"watchEndpoint":{"videoId":"${id}"}},"c":[{"chapterRenderer":{"title":{"simpleText":"Old intro"},"timeRangeStartMillis":0}},{"chapterRenderer":{"title":{"simpleText":"Old part"},"timeRangeStartMillis":5000}}]};`;
    const url = "https://www.youtube.com/watch?v=new0000001";
    expect(
      chaptersFor({ initialDataScript: script("new0000001"), description: null }, url),
    ).toMatchObject({
      bound: true,
      chapters: [{ title: "Old intro" }, { title: "Old part" }],
    });
    // The inline script still describes the previous video: its chapters are not this video's.
    const stale = chaptersFor({ initialDataScript: script("old0000001"), description: null }, url);
    expect(stale.bound).toBe(false);
    // The rendered description is the page as it is now.
    expect(
      chaptersFor(
        { initialDataScript: script("old0000001"), description: "0:00 A\n0:05 B\n0:10 C" },
        url,
      ),
    ).toEqual({
      bound: true,
      chapters: [
        { title: "A", start: 0 },
        { title: "B", start: 5 },
        { title: "C", start: 10 },
      ],
    });
    expect(chapterBlocks(stale.chapters, new Set(), false).every((b) => !b.verified)).toBe(true);
  });
});
