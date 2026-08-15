import { describe, expect, it } from "vitest";
import { formatTimecode } from "./timecode.ts";

describe("formatTimecode", () => {
  it("formats [mm:ss] and [h:mm:ss]", () => {
    expect(formatTimecode(0)).toBe("[00:00]");
    expect(formatTimecode(65.9)).toBe("[01:05]");
    expect(formatTimecode(3_725)).toBe("[1:02:05]");
  });
});
