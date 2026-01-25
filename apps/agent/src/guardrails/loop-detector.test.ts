import { describe, expect, it } from "vitest";
import { LoopDetector } from "./loop-detector.ts";

describe("LoopDetector (spec §5.5)", () => {
  it("trips on the same action on the same screen three times", () => {
    const detector = new LoopDetector();
    expect(detector.recordAction("click 1,1", 0b1010n)).toBe(false);
    expect(detector.recordAction("click 1,1", 0b1011n)).toBe(false);
    expect(detector.recordAction("click 1,1", 0b1010n)).toBe(true);
  });
  it("resets when the action or the screen changes", () => {
    const detector = new LoopDetector();
    detector.recordAction("a", 0n);
    detector.recordAction("a", 0n);
    expect(detector.recordAction("b", 0n)).toBe(false);
    expect(detector.recordAction("b", 0xffffn)).toBe(false);
  });
  it("trips after 8 observations without URL, DOM or note change", () => {
    const detector = new LoopDetector();
    const same = { url: "u", domHash: "h", notesChanged: false };
    for (let i = 0; i < 8; i++) expect(detector.recordObservation(same)).toBe(false);
    expect(detector.recordObservation(same)).toBe(true);
    detector.reset();
    expect(detector.recordObservation(same)).toBe(false);
    expect(detector.recordObservation({ ...same, notesChanged: true })).toBe(false);
  });
});
