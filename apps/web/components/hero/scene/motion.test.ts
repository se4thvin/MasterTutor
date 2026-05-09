import { describe, expect, it } from "vitest";
import { springs } from "@/lib/motion-tokens.ts";
import { createSpring, smoothstep, stepSprings } from "./motion.ts";

const spring = springs.spring;

describe("hero springs", () => {
  it("settles the D21 spring in ~450ms with ~3% overshoot", () => {
    const s = createSpring(0, spring);
    s.target = 1;
    let peak = 0;
    for (let t = 0; t < 0.6; t += 1 / 60) {
      stepSprings([s], 1 / 60);
      peak = Math.max(peak, s.x);
    }
    expect(Math.abs(s.x - 1)).toBeLessThan(0.01);
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.05);
  });

  it("stays stable on a long 1/20s frame", () => {
    const s = createSpring(0, spring);
    s.target = 1;
    stepSprings([s], 1 / 20);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeLessThan(1.2);
  });

  it("smoothsteps", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });
});
