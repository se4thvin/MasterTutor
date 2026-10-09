import { describe, expect, it } from "vitest";
import { PIP_STATES, type PipState } from "../pip-types.ts";
import {
  blendPose,
  createBlender,
  dominantState,
  setBlendTarget,
  stateAge,
  stepBlender,
} from "./blender.ts";
import { POSE_KEYS, poseOf, type Pose } from "./poses.ts";

const FRAME = 1 / 60;
const ctx = { held: null } as const;

/** Largest per-frame change of any angle-like or offset pose value. */
function maxStep(a: Pose, b: Pose) {
  return Math.max(...POSE_KEYS.map((k) => Math.abs(a[k] - b[k])));
}

describe("state blender", () => {
  it("keeps the weights a partition of one and converges on the target", () => {
    const blender = createBlender("idle", 0);
    setBlendTarget(blender, "celebrating", 0);
    for (let i = 0; i < 90; i++) {
      stepBlender(blender, FRAME);
      const sum = PIP_STATES.reduce((s, k) => s + blender.weights[k], 0);
      expect(sum).toBeCloseTo(1, 9);
      for (const k of PIP_STATES) expect(blender.weights[k]).toBeGreaterThanOrEqual(0);
    }
    expect(blender.weights.celebrating).toBeGreaterThan(0.99);
    expect(dominantState(blender)).toBe("celebrating");
  });

  it("never overshoots or pops: weights move smoothly from rest", () => {
    const blender = createBlender("idle", 0);
    setBlendTarget(blender, "working", 0);
    stepBlender(blender, FRAME);
    // A critically damped start: the first frame barely moves.
    expect(blender.weights.working).toBeLessThan(0.05);
    let previous = blender.weights.working;
    for (let i = 0; i < 120; i++) {
      stepBlender(blender, FRAME);
      expect(blender.weights.working).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(blender.weights.working).toBeLessThanOrEqual(1);
      previous = blender.weights.working;
    }
  });

  it("blends every pair of states without a pop", () => {
    for (const from of PIP_STATES) {
      for (const to of PIP_STATES) {
        if (from === to) continue;
        const blender = createBlender(from, 0);
        let now = 1.3; // mid-loop, not at a state's rest pose
        for (let i = 0; i < 20; i++) stepBlender(blender, FRAME);
        let previous = blendPose(blender, now, ctx);
        setBlendTarget(blender, to, now);
        for (let i = 0; i < 60; i++) {
          now += FRAME;
          stepBlender(blender, FRAME);
          const pose = blendPose(blender, now, ctx);
          // A big gesture (an arm raised to wave) may sweep up to ~14° in a frame, never jump.
          expect(maxStep(previous, pose), `${from} → ${to}, frame ${i}`).toBeLessThan(0.25);
          previous = pose;
        }
      }
    }
  });

  it("restarts a state's clock only when it comes back from fully faded", () => {
    const blender = createBlender("idle", 0);
    setBlendTarget(blender, "waving", 1);
    for (let i = 0; i < 6; i++) stepBlender(blender, FRAME);
    setBlendTarget(blender, "idle", 1.1);
    setBlendTarget(blender, "waving", 1.2);
    // The wave was still visible: it continues rather than restarting mid-air.
    expect(stateAge(blender, "waving", 1.2)).toBeCloseTo(0.2, 6);
    for (let i = 0; i < 240; i++) stepBlender(blender, FRAME);
    setBlendTarget(blender, "idle", 5);
    for (let i = 0; i < 240; i++) stepBlender(blender, FRAME);
    setBlendTarget(blender, "waving", 9);
    expect(stateAge(blender, "waving", 9)).toBe(0);
  });
});

describe("state poses", () => {
  const sample = (state: PipState, seconds: number) => {
    const out: Pose[] = [];
    for (let t = 0; t < seconds; t += FRAME) out.push(poseOf(state, t, ctx));
    return out;
  };

  it("animate continuously inside every state (loops have no seams)", () => {
    for (const state of PIP_STATES) {
      const poses = sample(state, 8);
      for (let i = 1; i < poses.length; i++)
        expect(maxStep(poses[i - 1]!, poses[i]!), `${state} at frame ${i}`).toBeLessThan(0.16);
    }
  });

  it("breathe in idle: a subtle squash and stretch", () => {
    const squash = sample("idle", 4).map((p) => p.breath);
    expect(Math.max(...squash) - Math.min(...squash)).toBeGreaterThan(0.5);
  });

  it("allow blinking wherever the eyes are open, and close them when dozing", () => {
    for (const state of PIP_STATES) {
      const pose = poseOf(state, 1, ctx);
      if (state === "dozing") {
        expect(pose.sleepy).toBe(1);
        expect(pose.blinks).toBe(0);
      } else if (pose.happy < 0.5 && pose.sleepy < 0.5) {
        expect(pose.blinks, state).toBe(1);
      }
    }
  });

  it("show the right props: laptop, book, party hat, bubbles, zzz", () => {
    expect(poseOf("working", 2, ctx).laptop).toBe(1);
    expect(poseOf("reading", 2, ctx).book).toBe(1);
    expect(poseOf("celebrating", 2, ctx).partyHat).toBe(1);
    expect(poseOf("thinking", 2, ctx).bubbles).toBe(1);
    expect(poseOf("dozing", 2, ctx).zzz).toBe(1);
    expect(poseOf("idle", 2, ctx).laptop).toBe(0);
  });

  it("droop the sprout when dozing and perk it when celebrating", () => {
    expect(poseOf("dozing", 2, ctx).droop).toBeGreaterThan(0.8);
    expect(poseOf("idle", 2, ctx).droop).toBe(0);
    expect(poseOf("celebrating", 2, ctx).droop).toBeLessThan(0);
  });

  it("hop when celebrating and bounce gently when waiting", () => {
    const peak = (state: PipState) => Math.max(...sample(state, 3).map((p) => p.lift));
    expect(peak("celebrating")).toBeGreaterThan(0.08);
    expect(peak("waiting")).toBeGreaterThan(0.01);
    expect(peak("waiting")).toBeLessThan(0.05);
    expect(peak("idle")).toBe(0);
  });

  it("hold a book or laptop accessory with the arms in every calm state", () => {
    const holding = poseOf("idle", 1, { held: "book" });
    const free = poseOf("idle", 1, ctx);
    expect(holding.armLx).toBeLessThan(free.armLx - 0.5);
  });
});
