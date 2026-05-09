import { describe, expect, it } from "vitest";
import { ARC_MAX_PX, arcControl, pointOnArc, toViewport, travelMs } from "./cursor-path.ts";

describe("cursor path", () => {
  it("travels 250–450ms depending on distance", () => {
    expect(travelMs({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(250);
    expect(travelMs({ x: 0, y: 0 }, { x: 200, y: 0 })).toBe(320);
    expect(travelMs({ x: 0, y: 0 }, { x: 2000, y: 0 })).toBe(450);
  });

  it("bends perpendicular to the path, capped", () => {
    const c = arcControl({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(c).toEqual({ x: 50, y: 20 });
    const far = arcControl({ x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(far.y).toBe(ARC_MAX_PX);
  });

  it("starts and ends on the endpoints", () => {
    const from = { x: 10, y: 20 };
    const to = { x: 300, y: 400 };
    const c = arcControl(from, to);
    expect(pointOnArc(from, c, to, 0)).toEqual(from);
    expect(pointOnArc(from, c, to, 1)).toEqual(to);
  });

  it("scales 1280×800 points into the rendered viewport", () => {
    expect(toViewport({ x: 640, y: 400 }, { width: 640, height: 400 })).toEqual({ x: 320, y: 200 });
  });
});
