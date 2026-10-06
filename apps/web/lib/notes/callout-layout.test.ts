import { describe, expect, it } from "vitest";
import { layoutCallouts } from "./callout-layout.ts";

const opts = { gap: 12, containerHeight: 1000 };

describe("layoutCallouts", () => {
  it("keeps captions at their anchors when there is room", () => {
    expect(
      layoutCallouts(
        [
          { id: "a", anchorTop: 0, height: 40 },
          { id: "b", anchorTop: 200, height: 40 },
        ],
        opts,
      ),
    ).toEqual([
      { id: "a", top: 0, hidden: false },
      { id: "b", top: 200, hidden: false },
    ]);
  });
  it("pushes colliding captions down in order", () => {
    const out = layoutCallouts(
      [
        { id: "a", anchorTop: 100, height: 60 },
        { id: "b", anchorTop: 110, height: 40 },
      ],
      opts,
    );
    expect(out[1]).toEqual({ id: "b", top: 172, hidden: false });
  });
  it("sorts by anchor and shifts up when the last caption would overflow", () => {
    const out = layoutCallouts(
      [
        { id: "z", anchorTop: 980, height: 50 },
        { id: "y", anchorTop: 900, height: 50 },
      ],
      opts,
    );
    expect(out.map((o) => o.id)).toEqual(["y", "z"]);
    expect(out[1]!.top + 50).toBeLessThanOrEqual(1000);
    expect(out[1]!.top - (out[0]!.top + 50)).toBeGreaterThanOrEqual(12);
  });
  it("hides captions that cannot fit rather than overlapping", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      anchorTop: i,
      height: 60,
    }));
    const out = layoutCallouts(many, { gap: 12, containerHeight: 300 });
    const shown = out.filter((o) => !o.hidden);
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i]!.top).toBeGreaterThanOrEqual(shown[i - 1]!.top + 72);
    }
    expect(shown.every((o) => o.top >= 0 && o.top + 60 <= 300)).toBe(true);
    expect(out.some((o) => o.hidden)).toBe(true);
  });
  it("never overlaps, whatever the anchors", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      anchorTop: (i * 137) % 600,
      height: 30 + ((i * 17) % 40),
    }));
    const shown = layoutCallouts(items, { gap: 12, containerHeight: 700 })
      .filter((o) => !o.hidden)
      .map((o) => ({ ...o, height: items.find((i) => i.id === o.id)!.height }))
      .sort((a, b) => a.top - b.top);
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i]!.top).toBeGreaterThanOrEqual(shown[i - 1]!.top + shown[i - 1]!.height + 12);
    }
    expect(shown.every((o) => o.top >= 0 && o.top + o.height <= 700)).toBe(true);
  });
});
