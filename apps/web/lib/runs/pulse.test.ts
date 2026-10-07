import { describe, expect, it } from "vitest";
import { finishedIds, flashStatus } from "./pulse.ts";

describe("finishedIds", () => {
  it("lists runs that left the running list", () => {
    expect(finishedIds(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
    expect(finishedIds(["a"], ["a", "d"])).toEqual([]);
    expect(finishedIds([], [])).toEqual([]);
  });
});

describe("flashStatus (Review Focus 5)", () => {
  it("flashes the outcome; failure wins, then success, then a stop", () => {
    expect(flashStatus(["completed"])).toBe("done");
    expect(flashStatus(["completed", "failed"])).toBe("failed");
    expect(flashStatus(["cancelled", "completed"])).toBe("done");
    expect(flashStatus(["cancelled"])).toBe("cancelled");
  });
  it("does not flash a run that only paused (waiting, sleeping) or unknown runs", () => {
    expect(flashStatus(["waiting"])).toBeNull();
    expect(flashStatus(["sleeping", "queued"])).toBeNull();
    expect(flashStatus([])).toBeNull();
  });
});
