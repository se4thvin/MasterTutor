import { describe, expect, it } from "vitest";
import { clamp01, cubicBezier } from "./easing.ts";

describe("cubicBezier", () => {
  it("matches CSS endpoints and the linear curve", () => {
    const linear = cubicBezier([0, 0, 1, 1]);
    expect(linear(0)).toBe(0);
    expect(linear(1)).toBe(1);
    expect(linear(0.3)).toBeCloseTo(0.3, 3);
  });

  it("is monotonic and front-loaded for the cursor curve", () => {
    const cursor = cubicBezier([0.2, 0.8, 0.2, 1]);
    let prev = 0;
    for (let x = 0.05; x <= 1; x += 0.05) {
      const y = cursor(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    expect(cursor(0.5)).toBeGreaterThan(0.85);
  });

  it("clamps", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});
