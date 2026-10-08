import { describe, expect, it } from "vitest";
import { groupSegments, transcriptBlocks } from "./transcript-blocks.ts";

const seg = (start: number, text: string, speaker?: string) => ({
  start,
  end: start + 2.5,
  text,
  ...(speaker ? { speaker } : {}),
});

describe("groupSegments", () => {
  it("breaks at chapter starts, duration, size and speaker", () => {
    const groups = groupSegments(
      [seg(0, "a."), seg(2.5, "b."), seg(5, "c."), seg(7.5, "d.", "B")],
      [0, 5],
    );
    expect(groups.map((g) => [g.start, g.text])).toEqual([
      [0, "a. b."],
      [5, "c."],
      [7.5, "d."],
    ]);
    expect(
      groupSegments(
        Array.from({ length: 20 }, (_, i) => seg(i * 2.5, "x")),
        [],
      ).length,
    ).toBeGreaterThan(1);
  });
  it("renders escaped text with the time in the anchor only, and speakers for ASR", () => {
    const [caption] = transcriptBlocks(
      [{ start: 65, end: 70, text: "Hi *there*" }],
      "captions",
      true,
    );
    expect(caption).toMatchObject({
      type: "transcript",
      markdown: "Hi \\*there\\*",
      origin: "captions",
      verified: true,
      anchor: { tStart: 65, tEnd: 70 },
    });
    const [asr] = transcriptBlocks([{ start: 0, end: 1, text: "Yes", speaker: "A" }], "asr", false);
    expect(asr?.markdown).toBe("**Speaker A:** Yes");
  });
});
