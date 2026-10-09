import { springs } from "@/lib/motion-tokens.ts";
import { createSpring, stepSprings, type Spring } from "@/lib/spring.ts";
import { PIP_STATES, type PipState } from "../pip-types.ts";
import { POSE_KEYS, poseOf, zeroPose, type Pose, type PoseContext } from "./poses.ts";

/**
 * Crossfades between states: each state has a critically damped weight spring (pipBlend), the
 * weights are normalised to sum to one, and the shown pose is the weighted sum of every visible
 * state's procedural pose. Starting from rest, a blend never pops and never overshoots.
 */
export interface Blender {
  target: PipState;
  springs: Record<PipState, Spring>;
  weights: Record<PipState, number>;
  /** When each state's clock started (seconds). */
  entered: Record<PipState, number>;
}

const FADED = 0.01;

const perState = <T>(fn: (state: PipState) => T) =>
  Object.fromEntries(PIP_STATES.map((s) => [s, fn(s)])) as Record<PipState, T>;

export function createBlender(state: PipState, now: number): Blender {
  return {
    target: state,
    springs: perState((s) => createSpring(s === state ? 1 : 0, springs.pipBlend)),
    weights: perState((s) => (s === state ? 1 : 0)),
    entered: perState(() => now),
  };
}

export function setBlendTarget(b: Blender, state: PipState, now: number): void {
  if (state === b.target) return;
  // A state that is still visible keeps its clock, so flicking back never restarts it mid-move.
  if (b.weights[state] < FADED) b.entered[state] = now;
  b.target = state;
  for (const s of PIP_STATES) b.springs[s].target = s === state ? 1 : 0;
}

export function stepBlender(b: Blender, dt: number): void {
  const list = PIP_STATES.map((s) => b.springs[s]);
  stepSprings(list, dt);
  let sum = 0;
  for (const s of PIP_STATES) {
    const w = Math.max(0, b.springs[s].x);
    b.weights[s] = w < 1e-4 ? 0 : w;
    sum += b.weights[s];
  }
  if (sum <= 0) {
    for (const s of PIP_STATES) b.weights[s] = s === b.target ? 1 : 0;
    return;
  }
  for (const s of PIP_STATES) b.weights[s] /= sum;
}

export const stateAge = (b: Blender, state: PipState, now: number): number =>
  now - b.entered[state];

export function dominantState(b: Blender): PipState {
  let best: PipState = b.target;
  for (const s of PIP_STATES) if (b.weights[s] > b.weights[best]) best = s;
  return best;
}

/** The weighted sum of every visible state's pose at `now` (seconds). */
export function blendPose(b: Blender, now: number, ctx: PoseContext): Pose {
  const out = zeroPose();
  for (const k of POSE_KEYS) out[k] = 0;
  for (const s of PIP_STATES) {
    const w = b.weights[s];
    if (w === 0) continue;
    const pose = poseOf(s, stateAge(b, s, now), ctx);
    for (const k of POSE_KEYS) out[k] += pose[k] * w;
  }
  return out;
}
