import { durations } from "@/lib/motion-tokens.ts";
import type { PipState } from "../pip-types.ts";

/**
 * One state's procedural pose at `t` seconds after it was entered (3d-readiness.md §4). Every
 * field is a plain number so the blender can mix states linearly; every function is continuous
 * in `t`, so loops have no seams. Angles are radians.
 */
export interface Pose {
  /** Root: hop height (body units) and squash (−) / stretch (+). Feet stay planted on the root. */
  lift: number;
  squash: number;
  /** Body: roll, yaw and pitch (+ looks down). */
  lean: number;
  turn: number;
  nod: number;
  /** Breathing, −amp…+amp; 1 is the idle breath (scale y ±1.5%). */
  breath: number;
  /** Arms: z swings outward from hanging (0), x swings forward (negative raises in front). */
  armLz: number;
  armLx: number;
  armRz: number;
  armRx: number;
  /** How much the lookAt target turns the head (0 faces the viewer). */
  lookGain: number;
  /** State-driven glance of the eyes, −1…1 of their travel. */
  gazeX: number;
  gazeY: number;
  /** Expression weights; neutral is what remains. */
  happy: number;
  sleepy: number;
  focused: number;
  oops: number;
  thinking: number;
  mouthOpen: number;
  brow: number;
  blush: number;
  /** 1 where random blinks may run (eyes open). */
  blinks: number;
  /** Prop presence, 0…1 (props scale in with their weight). `bubbles` fills in one by one. */
  laptop: number;
  book: number;
  partyHat: number;
  bubbles: number;
  zzz: number;
  sweat: number;
  /** Laptop screen glow. */
  glow: number;
  /** Sprout: −1 perked … 0 upright … 1 drooped; sway is the idle breeze. */
  droop: number;
  sway: number;
}

type PoseKey = keyof Pose;

const ZERO: Pose = {
  lift: 0,
  squash: 0,
  lean: 0,
  turn: 0,
  nod: 0,
  breath: 0,
  armLz: 0,
  armLx: 0,
  armRz: 0,
  armRx: 0,
  lookGain: 0,
  gazeX: 0,
  gazeY: 0,
  happy: 0,
  sleepy: 0,
  focused: 0,
  oops: 0,
  thinking: 0,
  mouthOpen: 0,
  brow: 0,
  blush: 0.85,
  blinks: 1,
  laptop: 0,
  book: 0,
  partyHat: 0,
  bubbles: 0,
  zzz: 0,
  sweat: 0,
  glow: 0,
  droop: 0,
  sway: 1,
};

export const POSE_KEYS = Object.keys(ZERO) as readonly PoseKey[];
export const zeroPose = (): Pose => ({ ...ZERO });

/** What Pip holds as an accessory, which changes the resting arms. */
export interface PoseContext {
  held: "book" | "laptop" | null;
}

const deg = (d: number) => (d * Math.PI) / 180;
const TAU = Math.PI * 2;
const wave = (t: number, period: number, phase = 0) => Math.sin((TAU * t) / period + phase);
/** A half-sine bump on [a, b], zero elsewhere: continuous, for one-shot squash and hops. */
const bump = (u: number, a: number, b: number) =>
  u <= a || u >= b ? 0 : Math.sin((Math.PI * (u - a)) / (b - a));
/** A parabolic arc on [a, b] peaking at 1: a hop's height. */
const arc = (u: number, a: number, b: number) => {
  if (u <= a || u >= b) return 0;
  const s = (u - a) / (b - a);
  return 4 * s * (1 - s);
};
const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

const BREATH_S = 3.2;
const DOZE_BREATH_S = 4.8;
const HOP_EVERY_S = durations.flash / 1000;
const TYPE_S = 0.36;
const WIGGLE_S = 0.52;
const CELEBRATE_S = 2;
const READ_SWEEP_S = durations.drift / 1000;
/** Thought bubbles fill in one after another. */
const BUBBLE_FILL_S = 0.9;

const ARMS = {
  rest: { z: deg(18), x: 0 },
  hold: { z: deg(-22), x: deg(-58) },
  type: { z: deg(-12), x: deg(-72) },
};

function restArms(p: Pose, ctx: PoseContext, t: number): void {
  const base = ctx.held === "book" ? ARMS.hold : ctx.held === "laptop" ? ARMS.type : ARMS.rest;
  const sway = ctx.held ? 0 : deg(2.5);
  p.armLz = base.z + sway * wave(t, BREATH_S, 0.6);
  p.armRz = base.z + sway * wave(t, BREATH_S, 2.2);
  p.armLx = base.x;
  p.armRx = base.x;
}

const POSES: Record<PipState, (p: Pose, t: number, ctx: PoseContext) => void> = {
  idle(p, t, ctx) {
    restArms(p, ctx, t);
    p.breath = wave(t, BREATH_S);
    p.lean = deg(1.6) * wave(t, BREATH_S * 2, 0.4);
    p.turn = deg(3) * wave(t, 9.5);
    p.lookGain = 0.6;
  },
  attentive(p, t, ctx) {
    restArms(p, ctx, t);
    if (!ctx.held) p.armLz = p.armRz = deg(26);
    p.breath = wave(t, BREATH_S);
    p.lift = 0.02;
    p.squash = 0.02;
    p.lookGain = 1;
    p.brow = 0.35;
  },
  thinking(p, t, ctx) {
    restArms(p, ctx, t);
    // Hand to cheek: forward and up, a little outward so the stub clears the egg.
    p.armRz = deg(6);
    p.armRx = deg(-128) + deg(3) * wave(t, 2.6);
    p.breath = wave(t, BREATH_S);
    p.lean = deg(4);
    p.turn = deg(6);
    p.nod = deg(-2) + deg(1.5) * wave(t, 2.6);
    p.gazeX = 0.45;
    p.gazeY = 0.6;
    p.thinking = 1;
    p.lookGain = 0.2;
    p.bubbles = Math.min(1, t / BUBBLE_FILL_S);
  },
  working(p, t) {
    const tap = deg(6);
    p.armLz = ARMS.type.z;
    p.armRz = ARMS.type.z;
    p.armLx = ARMS.type.x + tap * wave(t, TYPE_S);
    p.armRx = ARMS.type.x + tap * wave(t, TYPE_S, Math.PI);
    p.breath = wave(t, BREATH_S);
    p.nod = deg(9);
    p.gazeY = -0.55;
    p.focused = 1;
    p.lookGain = 0.15;
    p.laptop = 1;
    p.glow = 0.5 + 0.5 * wave(t, durations.pulse / 1000);
    p.sway = 0.6;
  },
  waiting(p, t, ctx) {
    restArms(p, ctx, t);
    p.armRz = deg(96) + deg(5) * wave(t, HOP_EVERY_S);
    p.armRx = deg(-10);
    const u = t % HOP_EVERY_S;
    // A gentle bounce eases off the ground (sin²), unlike the celebration's real jump.
    p.lift = 0.032 * bump(u, 0, 0.36) ** 2;
    p.squash = 0.03 * bump(u, 0, 0.36) - 0.03 * bump(u, 0.32, 0.5);
    p.breath = wave(t, BREATH_S);
    p.brow = 1;
    p.lookGain = 0;
  },
  waving(p, t, ctx) {
    restArms(p, ctx, t);
    p.armRz = deg(146) + deg(18) * wave(t, WIGGLE_S);
    p.armRx = deg(-8);
    p.lean = deg(-4);
    p.turn = deg(6);
    p.lift = 0.012 * (0.5 - 0.5 * Math.cos((TAU * t) / WIGGLE_S));
    p.breath = wave(t, BREATH_S);
    p.happy = 1;
    p.mouthOpen = 1;
    p.blush = 1;
    p.blinks = 0;
    p.lookGain = 0.4;
  },
  celebrating(p, t) {
    const u = t % CELEBRATE_S;
    p.lift = 0.11 * arc(u, 0.12, 0.62);
    p.squash = -0.1 * bump(u, 0, 0.14) + 0.07 * bump(u, 0.12, 0.38) - 0.09 * bump(u, 0.6, 0.8);
    p.turn = deg(10) * wave(t, CELEBRATE_S);
    p.armLz = deg(150) + deg(9) * wave(t, 0.5);
    p.armRz = deg(150) + deg(9) * wave(t, 0.5, Math.PI);
    p.armLx = p.armRx = deg(-10);
    p.happy = 1;
    p.mouthOpen = 1;
    p.blush = 1.1;
    p.blinks = 0;
    p.partyHat = 1;
    p.droop = -1;
    p.lookGain = 0.3;
  },
  dozing(p, t, ctx) {
    restArms(p, ctx, t);
    if (!ctx.held) p.armLz = p.armRz = deg(6);
    p.breath = 1.6 * wave(t, DOZE_BREATH_S);
    p.lean = deg(-6) + deg(1) * wave(t, DOZE_BREATH_S);
    p.nod = deg(5);
    p.sleepy = 1;
    p.blinks = 0;
    p.zzz = 1;
    p.droop = 1;
    p.sway = 0.2;
  },
  oops(p, t, ctx) {
    p.armLz = p.armRz = deg(-6);
    p.armLx = p.armRx = deg(-24);
    if (ctx.held) restArms(p, ctx, t);
    // Three quick shakes that die away, then a sheepish hold.
    p.lean = deg(4) * Math.sin((TAU * t) / 0.18) * Math.exp(-t * 3.2);
    p.squash = -0.045;
    p.breath = wave(t, BREATH_S);
    p.turn = deg(-7);
    p.gazeX = -0.55;
    p.gazeY = -0.3;
    p.oops = 1;
    p.blush = 1.25;
    p.sweat = 1;
    p.lookGain = 0.2;
  },
  reading(p, t) {
    p.armLz = p.armRz = ARMS.hold.z;
    p.armLx = p.armRx = ARMS.hold.x;
    // Reads a line left → right, then returns quickly to the next one.
    const u = (t % READ_SWEEP_S) / READ_SWEEP_S;
    const sweep = u < 0.82 ? smooth(u / 0.82) : 1 - smooth((u - 0.82) / 0.18);
    p.gazeX = -0.65 + 1.3 * sweep;
    p.gazeY = -0.5;
    p.turn = deg(5) * (sweep * 2 - 1);
    p.nod = deg(8);
    p.breath = wave(t, BREATH_S);
    p.focused = 1;
    p.book = 1;
    p.lookGain = 0;
  },
};

export function poseOf(state: PipState, t: number, ctx: PoseContext): Pose {
  const pose = zeroPose();
  POSES[state](pose, Math.max(0, t), ctx);
  return pose;
}

/** Seconds into a celebration cycle when confetti bursts (take-off, so it spreads by the top). */
export const CONFETTI = { everyS: CELEBRATE_S, atS: 0.14 } as const;
/** Seconds between page turns while reading. */
export const PAGE_TURN_S = READ_SWEEP_S;
