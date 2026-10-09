import { describe, expect, it } from "vitest";
import { LOOK_LIMITS, lookToward } from "./look.ts";

const rect = { left: 100, top: 100, width: 300, height: 300 };
// The eye line sits at 42% of the frame's height.
const eyes = { x: 250, y: 100 + 300 * 0.42 };

describe("look-at maths", () => {
  it("looks straight ahead at a target on the eye line", () => {
    const look = lookToward(eyes, rect);
    expect(look.yaw).toBeCloseTo(0, 6);
    expect(look.pitch).toBeCloseTo(0, 6);
  });

  it("turns toward the target's side, up and down", () => {
    expect(lookToward({ x: eyes.x + 200, y: eyes.y }, rect).yaw).toBeGreaterThan(0);
    expect(lookToward({ x: eyes.x - 200, y: eyes.y }, rect).yaw).toBeLessThan(0);
    expect(lookToward({ x: eyes.x, y: eyes.y - 200 }, rect).pitch).toBeGreaterThan(0);
    expect(lookToward({ x: eyes.x, y: eyes.y + 200 }, rect).pitch).toBeLessThan(0);
  });

  it("is symmetric left and right", () => {
    const right = lookToward({ x: eyes.x + 120, y: eyes.y }, rect).yaw;
    const left = lookToward({ x: eyes.x - 120, y: eyes.y }, rect).yaw;
    expect(right).toBeCloseTo(-left, 9);
  });

  it("never exceeds the turn limits, however far the target is", () => {
    for (const x of [-1e6, -5000, 5000, 1e6]) {
      for (const y of [-1e6, 1e6]) {
        const look = lookToward({ x, y }, rect);
        expect(Math.abs(look.yaw)).toBeLessThanOrEqual(LOOK_LIMITS.yaw);
        expect(Math.abs(look.pitch)).toBeLessThanOrEqual(LOOK_LIMITS.pitch);
      }
    }
  });

  it("grows monotonically with distance and saturates smoothly", () => {
    let previous = 0;
    for (let dx = 10; dx < 3000; dx += 10) {
      const yaw = lookToward({ x: eyes.x + dx, y: eyes.y }, rect).yaw;
      expect(yaw).toBeGreaterThan(previous);
      previous = yaw;
    }
    expect(previous).toBeGreaterThan(LOOK_LIMITS.yaw * 0.95);
  });

  it("gives a compact Pip the same reach as a hero one (a minimum range in px)", () => {
    const small = { left: 0, top: 0, width: 48, height: 48 };
    const near = lookToward({ x: 24 + 30, y: 48 * 0.42 }, small).yaw;
    // 30 px off-centre is a glance, not a full turn, even for a 48 px Pip.
    expect(near).toBeLessThan(LOOK_LIMITS.yaw * 0.3);
  });
});
