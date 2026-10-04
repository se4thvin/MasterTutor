import { describe, expect, it } from "vitest";
import { parseTimecode } from "./timecode.ts";

describe("parseTimecode", () => {
  it("parses description timestamps", () => {
    expect(parseTimecode("0:05")).toBe(5);
    expect(parseTimecode("1:02:03")).toBe(3_723);
    expect(parseTimecode("12:3")).toBeNull();
    expect(parseTimecode("abc")).toBeNull();
  });
});
