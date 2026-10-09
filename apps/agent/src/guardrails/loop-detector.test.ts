import { describe, expect, it } from "vitest";
import { UNCOMPARABLE_HASH } from "../browser/phash.ts";
import { LoopDetector } from "./loop-detector.ts";

describe("LoopDetector (spec §5.5)", () => {
  it("trips on the same action on the same screen three times", () => {
    const detector = new LoopDetector();
    expect(detector.recordAction("click 1,1", [10, 0])).toBe(false);
    expect(detector.recordAction("click 1,1", [11, 0])).toBe(false);
    expect(detector.recordAction("click 1,1", [10, 0])).toBe(true);
  });
  it("resets when the action or the screen changes", () => {
    const detector = new LoopDetector();
    detector.recordAction("a", [0]);
    detector.recordAction("a", [0]);
    expect(detector.recordAction("b", [0])).toBe(false);
    expect(detector.recordAction("b", [40])).toBe(false);
  });
  it("never matches uncomparable (withheld) frames", () => {
    const detector = new LoopDetector();
    for (let i = 0; i < 5; i++) expect(detector.recordAction("a", UNCOMPARABLE_HASH)).toBe(false);
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

it("reports pressure as the larger of the repeat count and the no-progress streak", () => {
  const detector = new LoopDetector();
  detector.recordObservation({ url: "u", domHash: "d", notesChanged: false });
  detector.recordObservation({ url: "u", domHash: "d", notesChanged: false });
  expect(detector.pressure).toBe(1);
});
