import { describe, expect, it } from "vitest";
import { CALLOUT_GAP, calloutPlacement } from "./callout.ts";

const box = { width: 800, height: 500 };
const label = { width: 240, height: 48 };

describe("calloutPlacement", () => {
  it("sits above-right of the target with a leader ending on it", () => {
    const p = calloutPlacement({ x: 300, y: 300 }, box, label);
    expect(p.left).toBe(316);
    expect(p.top).toBe(300 - CALLOUT_GAP - 48);
    expect(p.line.x2).toBe(300);
    expect(p.line.y2).toBe(300);
    expect(p.line.y1).toBe(p.top + 48);
  });

  it("flips below near the top and left near the right edge", () => {
    const p = calloutPlacement({ x: 780, y: 20 }, box, label);
    expect(p.top).toBe(20 + CALLOUT_GAP);
    expect(p.left + label.width).toBeLessThanOrEqual(box.width - 8);
    expect(p.line.y1).toBe(p.top);
  });

  it("never leaves the frame", () => {
    for (const target of [
      { x: 0, y: 0 },
      { x: 800, y: 500 },
      { x: 10, y: 490 },
    ]) {
      const p = calloutPlacement(target, box, label);
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.left + label.width).toBeLessThanOrEqual(box.width - 8);
      expect(p.top + label.height).toBeLessThanOrEqual(box.height - 8);
    }
  });
});
