import { describe, expect, it } from "vitest";
import {
  SPROUT_REST,
  createSprout,
  kickSprout,
  stepSprout,
  type Mat4,
  type SproutControl,
} from "./sprout.ts";

/** A column-major translation (the crown's world matrix). */
const translation = (x: number, y: number, z: number): Mat4 => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
];
const calm: SproutControl = { droop: 0, sway: 0, time: 0 };
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

function settle(frame: Mat4, control: SproutControl, seconds = 4) {
  const sprout = createSprout(frame);
  for (let t = 0; t < seconds; t += 1 / 60) stepSprout(sprout, frame, 1 / 60, control);
  return sprout;
}

describe("sprout secondary motion (position-based, two segments + leaves)", () => {
  it("rests in its upright shape when the body is still", () => {
    const frame = translation(0, 1, 0);
    const sprout = settle(frame, calm);
    const tip = sprout.points[2];
    expect(tip[1]).toBeGreaterThan(1 + SPROUT_REST.upright[2]![1] * 0.9);
    expect(Math.abs(tip[0] - SPROUT_REST.upright[2]![0])).toBeLessThan(0.02);
  });

  it("keeps both segment lengths", () => {
    const frame = translation(0, 1, 0);
    const sprout = settle(frame, { droop: 0.6, sway: 1, time: 0 });
    const [l1, l2] = SPROUT_REST.lengths;
    expect(dist(sprout.points[0], sprout.points[1])).toBeCloseTo(l1, 2);
    expect(dist(sprout.points[1], sprout.points[2])).toBeCloseTo(l2, 2);
  });

  it("lags behind a sudden move, wobbles past, then settles (never rigid)", () => {
    const sprout = settle(translation(0, 1, 0), calm);
    const moved = translation(0.2, 1, 0);
    stepSprout(sprout, moved, 1 / 60, calm);
    // The base follows at once; the tip trails behind it.
    expect(sprout.points[0][0]).toBeCloseTo(0.2 + SPROUT_REST.upright[0]![0], 6);
    const restTipX = 0.2 + SPROUT_REST.upright[2]![0];
    expect(sprout.points[2][0]).toBeLessThan(restTipX - 0.02);
    let overshoot = -Infinity;
    for (let t = 0; t < 1.5; t += 1 / 60) {
      stepSprout(sprout, moved, 1 / 60, calm);
      overshoot = Math.max(overshoot, sprout.points[2][0] - restTipX);
    }
    expect(overshoot).toBeGreaterThan(0.002);
    for (let t = 0; t < 4; t += 1 / 60) stepSprout(sprout, moved, 1 / 60, calm);
    expect(Math.abs(sprout.points[2][0] - restTipX)).toBeLessThan(0.005);
  });

  it("droops when dozing: the tip sinks and leans forward", () => {
    const frame = translation(0, 1, 0);
    const up = settle(frame, calm).points[2];
    const down = settle(frame, { droop: 1, sway: 0, time: 0 }).points[2];
    expect(down[1]).toBeLessThan(up[1] - 0.03);
    expect(down[2]).toBeGreaterThan(up[2] + 0.02);
  });

  it("perks up with a bounce after a kick", () => {
    const frame = translation(0, 1, 0);
    const sprout = settle(frame, calm);
    const rest = sprout.points[2][1];
    kickSprout(sprout, [0, 1.2, 0]);
    let flare = 0;
    for (let t = 0; t < 0.5; t += 1 / 60) {
      stepSprout(sprout, frame, 1 / 60, calm);
      flare = Math.max(flare, Math.abs(sprout.leafSpread));
    }
    // Lengths are kept, so "up" shows as the leaves flaring, then settling back.
    expect(flare).toBeGreaterThan(0.05);
    for (let t = 0; t < 3; t += 1 / 60) stepSprout(sprout, frame, 1 / 60, calm);
    expect(Math.abs(sprout.leafSpread)).toBeLessThan(0.01);
    expect(sprout.points[2][1]).toBeCloseTo(rest, 2);
  });

  it("sways gently in idle", () => {
    const frame = translation(0, 1, 0);
    const sprout = settle(frame, calm);
    const xs: number[] = [];
    for (let t = 0; t < 4; t += 1 / 60) {
      stepSprout(sprout, frame, 1 / 60, { droop: 0, sway: 1, time: t });
      xs.push(sprout.points[2][0]);
    }
    const range = Math.max(...xs) - Math.min(...xs);
    expect(range).toBeGreaterThan(0.003);
    expect(range).toBeLessThan(0.05);
  });

  it("stays stable on a long frame and after a huge jump", () => {
    const sprout = settle(translation(0, 1, 0), calm);
    stepSprout(sprout, translation(5, 1, 0), 1 / 4, calm);
    for (const p of sprout.points) for (const v of p) expect(Number.isFinite(v)).toBe(true);
    expect(dist(sprout.points[0], sprout.points[2])).toBeLessThan(0.3);
  });

  it("follows the crown's rotation (the rest shape is in crown space)", () => {
    // Rotated 90° about z: the crown's +y points along world -x.
    const rotated: Mat4 = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1];
    const tip = settle(rotated, calm).points[2];
    expect(tip[0]).toBeLessThan(-0.08);
  });
});
