import { describe, expect, it } from "vitest";
import { parseJson3 } from "./json3.ts";

describe("parseJson3", () => {
  it("joins segments, skips append newlines and empty events", () => {
    const body = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Hello" }, { utf8: " world" }] },
        { tStartMs: 1500, aAppend: 1, segs: [{ utf8: "\n" }] },
        { tStartMs: 2000, dDurationMs: 1000 },
        { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: "  again\n" }] },
      ],
    });
    expect(parseJson3(body)).toEqual([
      { start: 0, end: 2, text: "Hello world" },
      { start: 3, end: 4, text: "again" },
    ]);
  });
  it("returns null for non-JSON3 bodies", () => {
    expect(parseJson3("<transcript/>")).toBeNull();
    expect(parseJson3('{"x":1}')).toBeNull();
  });
});
