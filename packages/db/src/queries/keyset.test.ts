import { describe, expect, it } from "vitest";
import { KeysetCursorInvalid, keysetCursor, parseKeysetCursor } from "./keyset.ts";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("keyset cursors (one rule for audit, runs and notes)", () => {
  it("round-trips what keysetCursor produced", () => {
    const at = new Date("2026-10-06T08:00:00.123Z");
    expect(parseKeysetCursor(keysetCursor(at, ID))).toEqual({ at: at.toISOString(), id: ID });
    expect(parseKeysetCursor(null)).toBeNull();
  });

  it("refuses anything else, including non-canonical instants", () => {
    for (const bad of [
      "4",
      "",
      `2026-10-06T08:00:00Z|${ID}`,
      `2026-13-01T00:00:00.000Z|${ID}`,
      `2026-10-06T08:00:00.123Z|nope`,
    ])
      expect(() => parseKeysetCursor(bad)).toThrow(KeysetCursorInvalid);
  });
});
