import { describe, expect, it } from "vitest";
import { keysBetween } from "./positions.ts";

describe("keysBetween", () => {
  it("produces ordered keys under byte (C) ordering", () => {
    const keys = keysBetween(null, null, 70);
    const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sorted).toEqual(keys);
    const middle = keysBetween(keys[0]!, keys[1]!, 3);
    expect(middle.every((k) => k > keys[0]! && k < keys[1]!)).toBe(true);
    expect(keysBetween("a0", null, 0)).toEqual([]);
  });
});
