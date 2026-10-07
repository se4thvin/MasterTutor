import { describe, expect, it } from "vitest";
import { CAPTURE_END_S, LINE_STAGGER_S, captureCues, dueCues } from "./capture-timeline.ts";

describe("capture timeline", () => {
  it("fires inhale → shower → gulp → note → lines at 35ms → page, inside 2.4s", () => {
    const cues = captureCues(8);
    expect(cues.slice(0, 4).map((c) => c.key)).toEqual(["inhale", "shower", "gulp", "note"]);
    const lines = cues.filter((c) => c.key.startsWith("line"));
    expect(lines).toHaveLength(8);
    expect(lines[1]!.at - lines[0]!.at).toBeCloseTo(LINE_STAGGER_S, 6);
    expect(Math.max(...cues.map((c) => c.at))).toBeLessThan(CAPTURE_END_S);
  });

  it("fires each cue once as time passes", () => {
    const cues = captureCues(2);
    const fired = new Set<string>();
    expect(dueCues(cues, 0, fired)).toEqual(["inhale"]);
    expect(dueCues(cues, 0.8, fired)).toEqual(["shower", "gulp"]);
    expect(dueCues(cues, 0.8, fired)).toEqual([]);
    expect(dueCues(cues, 2, fired)).toEqual(["note", "line0", "line1", "page"]);
  });
});
