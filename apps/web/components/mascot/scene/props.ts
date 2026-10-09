import { Color, Group, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { seeded } from "../motion/random.ts";
import { clay } from "./clay.ts";
import { roundedBox, sphere, unitSphere } from "./primitives.ts";
import { CROWN_Y, EGG } from "./shape.ts";

/**
 * State props in clay, in body space unless noted: thought bubbles, Z letters, a sweat drop, and
 * confetti (an instanced burst in Pip's own space, ballistic, so it needs no per-piece state).
 */

/** Where the thought cloud floats (the instance bobs it around this height). */
export const CLOUD_Y = CROWN_Y + 0.24;

/** The three trail bubbles' radii, smallest first (the instance scales them in one by one). */
export const BUBBLE_RADII = [0.022, 0.03, 0.04] as const;

export function bubbles(): Group {
  const g = new Group();
  const white = clay("#ffffff", { gloss: 0.35 });
  const top = CROWN_Y;
  const w = EGG.radius;
  const trail: Array<[number, number]> = [
    [w * 0.92, top - 0.06],
    [w * 1.08, top + 0.03],
    [w * 1.22, top + 0.13],
  ];
  for (const [i, [x, y]] of trail.entries()) {
    const s = sphere(BUBBLE_RADII[i]!, white, false);
    s.position.set(x, y, 0.22);
    g.add(s);
  }
  const cloud = new Group();
  cloud.position.set(w * 1.46, CLOUD_Y, 0.12);
  for (const [x, y, r] of [
    [-0.1, 0, 0.085],
    [0, 0.04, 0.11],
    [0.1, 0, 0.085],
    [-0.045, -0.045, 0.08],
    [0.055, -0.045, 0.08],
  ] as const) {
    const s = sphere(r, white, false);
    s.position.set(x, y, 0);
    cloud.add(s);
  }
  const ink = clay("#636366", { gloss: 0.5 });
  for (const dx of [-0.055, 0, 0.055]) {
    const dot = sphere(0.016, ink, false);
    dot.position.set(dx, 0.005, 0.105);
    dot.name = "dot";
    cloud.add(dot);
  }
  g.add(cloud);
  return g;
}

function letterZ(size: number): Group {
  const m = clay("#a7b8dc", { gloss: 0.4 });
  const g = new Group();
  const t = size * 0.24;
  for (const y of [size / 2 - t / 2, -size / 2 + t / 2]) {
    const bar = roundedBox(size, t, t * 0.9, t * 0.45, m);
    bar.position.y = y;
    bar.castShadow = false;
    g.add(bar);
  }
  const diag = roundedBox(size * 1.22, t, t * 0.9, t * 0.45, m);
  diag.rotation.z = Math.atan2(size - t, size - t * 0.2);
  diag.castShadow = false;
  g.add(diag);
  return g;
}

/** Three Zs that rise, drift and fade in turn (positions are set per frame). */
export function zzz(): Group {
  const g = new Group();
  for (const size of [0.07, 0.09, 0.11]) g.add(letterZ(size));
  return g;
}

/** Each Z's phase-driven placement: rises from beside the head, grows, then shrinks away. */
export function placeZzz(group: Group, time: number, weight: number): void {
  const n = group.children.length;
  group.children.forEach((z, i) => {
    const phase = (time / 4.8 + i / n) % 1;
    const life = Math.sin(Math.PI * phase);
    z.position.set(EGG.radius * (0.7 + phase * 0.75), CROWN_Y - 0.05 + phase * 0.42, 0.15);
    z.rotation.z = 0.22 + 0.25 * Math.sin(time * 1.3 + i);
    const s = Math.max(0.0001, life * weight);
    z.scale.setScalar(s);
  });
}

export function sweatDrop(): Group {
  const g = new Group();
  const m = clay("#5fb4ff", { gloss: 1, rough: 0.15, sheen: 0 });
  const drop = sphere(0.04, m, false);
  drop.scale.set(0.04, 0.048, 0.03);
  const tip = sphere(0.02, m, false);
  tip.position.y = 0.04;
  tip.scale.set(0.016, 0.032, 0.013);
  g.add(drop, tip);
  g.position.set(EGG.radius * 0.72, CROWN_Y - 0.12, 0.26);
  return g;
}

const PIECES = 36;
const CONFETTI_COLORS = ["#2f8cf0", "#ffcc4d", "#ff7f5e", "#34c759", "#f0457a", "#ffffff"];
const GRAVITY = -2.4;
const LIFE_S = 1.6;

interface Piece {
  v: Vector3;
  spin: Vector3;
  start: Vector3;
}

export interface Confetti {
  mesh: InstancedMesh;
  pieces: Piece[];
}

/** 36 instanced pieces (one draw call), with seeded velocities so every burst looks alike. */
export function confetti(): Confetti {
  const base = clay("#ffffff", { gloss: 0.5 });
  const mesh = new InstancedMesh(unitSphere(), base, PIECES);
  mesh.frustumCulled = false;
  const rand = seeded(11);
  const pieces: Piece[] = [];
  const color = new Color();
  for (let i = 0; i < PIECES; i++) {
    const a = rand() * Math.PI * 2;
    const up = 0.55 + rand() * 0.55;
    const out = 0.45 + rand() * 0.45;
    pieces.push({
      v: new Vector3(Math.cos(a) * out, up, Math.sin(a) * out * 0.5 + 0.25),
      spin: new Vector3(rand() * 9, rand() * 9, rand() * 9),
      start: new Vector3((rand() - 0.5) * 0.2, CROWN_Y + 0.05, 0.05 + rand() * 0.1),
    });
    mesh.setColorAt(i, color.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]!));
  }
  mesh.castShadow = false;
  return { mesh, pieces };
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Object3D();
const pos = new Vector3();
const scale = new Vector3();

/** Places every piece `age` seconds after a burst; hidden outside its life. */
export function placeConfetti(c: Confetti, age: number, weight: number): void {
  const visible = age >= 0 && age < LIFE_S && weight > 0.05;
  c.mesh.visible = visible;
  if (!visible) return;
  const fade = Math.min(1, (LIFE_S - age) / 0.35) * Math.min(1, age / 0.05) * weight;
  c.pieces.forEach((p, i) => {
    pos.copy(p.start).addScaledVector(p.v, age);
    pos.y += 0.5 * GRAVITY * age * age;
    e.rotation.set(p.spin.x * age, p.spin.y * age, p.spin.z * age);
    q.setFromEuler(e.rotation);
    const round = i % 3 === 0;
    scale.set(round ? 0.02 : 0.03, round ? 0.02 : 0.013, round ? 0.02 : 0.006).multiplyScalar(fade);
    c.mesh.setMatrixAt(i, m4.compose(pos, q, scale));
  });
  c.mesh.instanceMatrix.needsUpdate = true;
}
