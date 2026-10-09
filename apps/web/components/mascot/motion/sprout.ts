import { springs } from "@/lib/motion-tokens.ts";

/**
 * The sprout's secondary motion: a two-segment stem simulated with position-based dynamics
 * (Verlet-style: integrate, then project the segment lengths), pulled toward a rest shape that
 * lives in the crown's frame. The base is pinned to the crown, so the stem lags, wobbles and
 * settles whenever Pip hops, turns or leans; it is never rigidly parented. Pure maths, no three.
 */

type Vec3 = [number, number, number];
/** Column-major 4×4, as three's Matrix4.elements. */
export type Mat4 = readonly number[];

export interface SproutControl {
  /** 0 upright … 1 drooping (dozing). Negative perks up (celebrating): leaves flare. */
  droop: number;
  /** 0 still … 1 the idle breeze. */
  sway: number;
  /** Seconds, for the breeze. */
  time: number;
}

export interface Sprout {
  /** base (pinned to the crown), joint, tip: world space. */
  points: [Vec3, Vec3, Vec3];
  velocities: [Vec3, Vec3, Vec3];
  /** Leaf flare in radians around their rest spread (positive opens upward). */
  leafSpread: number;
  leafVelocity: number;
  /** Crown-space rest targets of the last step, for interpolating a moving base. */
  lastTargets: [Vec3, Vec3, Vec3] | null;
}

/** Crown-space rest shapes (body units; the crown sits at the top of the egg). */
export const SPROUT_REST = {
  upright: [
    [0, -0.035, 0],
    [-0.004, 0.035, 0],
    [0.016, 0.105, 0],
  ] as readonly Vec3[],
  drooped: [
    [0, -0.035, 0],
    [0.002, 0.025, 0.035],
    [0.012, -0.005, 0.101],
  ] as readonly Vec3[],
  lengths: [0.0701, 0.0728] as const,
};

const SUBSTEP = 1 / 120;
const GRAVITY = -1.2;
/** Pull toward the rest shape (1/s²): upright is springy, drooped is limp. */
const STIFF_UP = 420;
const STIFF_DROOP = 55;
const DAMPING = 7.5;
const MAX_SPEED = 4;
const LEAF = { spring: springs.pipLeaf, flare: 0.45, droop: 0.55, flutter: 0.35 } as const;
const AXES = [0, 1, 2] as const;

function transform(m: Mat4, p: readonly number[]): Vec3 {
  const [x, y, z] = p as Vec3;
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function restTargets(m: Mat4, droop: number): [Vec3, Vec3, Vec3] {
  const t = Math.min(1, Math.max(0, droop));
  const shape = SPROUT_REST.upright.map((p, i) => {
    const q = SPROUT_REST.drooped[i]!;
    return [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
  });
  return [transform(m, shape[0]!), transform(m, shape[1]!), transform(m, shape[2]!)];
}

export function createSprout(crown: Mat4): Sprout {
  const points = restTargets(crown, 0);
  return {
    points,
    velocities: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    leafSpread: 0,
    leafVelocity: 0,
    lastTargets: points.map((p) => [...p]) as [Vec3, Vec3, Vec3],
  };
}

/** An impulse (body units per second) on the stem, strongest at the tip: a perk or a poke. */
export function kickSprout(s: Sprout, v: Vec3): void {
  for (const [i, gain] of [
    [1, 0.55],
    [2, 1],
  ] as const) {
    for (const k of AXES) s.velocities[i][k] += v[k] * gain;
  }
  s.leafVelocity += Math.hypot(...v) * 6;
}

function satisfy(a: Vec3, b: Vec3, length: number, pinnedA: boolean): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const d = Math.hypot(dx, dy, dz) || 1e-9;
  const diff = (d - length) / d;
  const wa = pinnedA ? 0 : 0.5;
  const wb = pinnedA ? 1 : 0.5;
  a[0] += dx * diff * wa;
  a[1] += dy * diff * wa;
  a[2] += dz * diff * wa;
  b[0] -= dx * diff * wb;
  b[1] -= dy * diff * wb;
  b[2] -= dz * diff * wb;
}

/** Advances the stem by `dt` seconds with the crown at world matrix `crown`. */
export function stepSprout(s: Sprout, crown: Mat4, dt: number, control: SproutControl): void {
  const targets = restTargets(crown, control.droop);
  const from = s.lastTargets ?? targets;
  const n = Math.max(1, Math.ceil(Math.min(dt, 0.25) / SUBSTEP));
  const h = Math.min(dt, 0.25) / n;
  const droop = Math.min(1, Math.max(0, control.droop));
  const k = lerp(STIFF_UP, STIFF_DROOP, droop);
  const damp = Math.exp(-DAMPING * h);
  const [l1, l2] = SPROUT_REST.lengths;

  for (let step = 1; step <= n; step++) {
    const f = step / n;
    // The base moves smoothly across substeps rather than teleporting once per frame.
    const target = (i: number): Vec3 => [
      lerp(from[i]![0], targets[i]![0], f),
      lerp(from[i]![1], targets[i]![1], f),
      lerp(from[i]![2], targets[i]![2], f),
    ];
    const old = s.points.map((p) => [...p] as Vec3);
    s.points[0] = target(0);
    const time = control.time - dt + f * dt;
    const breeze = control.sway * (2.4 * Math.sin(time * 1.9) + 1.1 * Math.sin(time * 3.1 + 1.3));
    for (const i of [1, 2] as const) {
      const t = target(i);
      const v = s.velocities[i];
      const wind = i === 2 ? breeze : breeze * 0.4;
      v[0] += (k * (t[0] - s.points[i][0]) + wind) * h;
      v[1] += (k * (t[1] - s.points[i][1]) + GRAVITY) * h;
      v[2] += (k * (t[2] - s.points[i][2]) + wind * 0.35) * h;
      const speed = Math.hypot(...v);
      const scale = (speed > MAX_SPEED ? MAX_SPEED / speed : 1) * damp;
      for (const c of AXES) {
        v[c] *= scale;
        s.points[i][c] += v[c] * h;
      }
    }
    for (let iteration = 0; iteration < 3; iteration++) {
      satisfy(s.points[0], s.points[1], l1, true);
      satisfy(s.points[1], s.points[2], l2, false);
    }
    // Velocities follow the projected positions (the Verlet step).
    for (const i of [1, 2] as const)
      for (const c of AXES) s.velocities[i][c] = (s.points[i][c] - old[i]![c]) / h;
    s.velocities[0] = [0, 0, 0];

    const tipUp = s.velocities[2][1];
    const leafTarget =
      Math.max(0, -control.droop) * LEAF.flare - droop * LEAF.droop - tipUp * LEAF.flutter * 0.1;
    s.leafVelocity +=
      (LEAF.spring.stiffness * (leafTarget - s.leafSpread) - LEAF.spring.damping * s.leafVelocity) *
      h;
    s.leafSpread += s.leafVelocity * h;
  }
  s.lastTargets = targets;
}
