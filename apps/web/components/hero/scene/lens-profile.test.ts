import { describe, expect, it } from "vitest";
import { LENS, lensProfile } from "./lens-profile.ts";

describe("lens profile", () => {
  it("runs axis-bottom → rounded rim → domed top-axis", () => {
    const pts = lensProfile();
    expect(pts).toHaveLength(37);
    expect(pts[0]).toEqual([0.001, -LENS.halfHeight]);
    expect(Math.max(...pts.map(([x]) => x))).toBeCloseTo(LENS.radius, 6);
    const [x, y] = pts.at(-1)!;
    expect(x).toBe(0.001);
    expect(y).toBeCloseTo(LENS.halfHeight + LENS.dome, 3);
  });
});
