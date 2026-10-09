// Code-built clay characters. Each builder returns a rig: root → body → parts, with arm pivots,
// a face and named accessory sockets (crown, eyes, ear.L/R, hand.L/R, lap, neck).
import { Group, MathUtils, Object3D, Vector3 } from "three";
import { concepts } from "../concepts.mjs";
import { buildFace } from "./face.js";
import { capsule, clay, ellipsoid, front, hit, lathe, rope, roundedBox, sphere, surfaceRope } from "./shapes.js";

const PI = Math.PI;
const byId = Object.fromEntries(concepts.map((c) => [c.id, c]));

/** Egg / gumdrop lathe profile: H tall, R wide, `bulge` widens the base, `fill` < 1 squares it off. */
const eggProfile = (H, R, bulge, fill = 1, y0 = 0.03) => (t) => {
  const a = t * PI;
  return [R * Math.pow(Math.sin(a), fill) * (1 + bulge * Math.cos(a)), y0 + (H * (1 - Math.cos(a))) / 2];
};

function arms(rig, { y, r, len, inset, mat }) {
  for (const side of [-1, 1]) {
    const h = hit(rig.surfaces, new Vector3(side * 4, y, 0.02), new Vector3(-side, 0, 0));
    const pivot = new Group();
    pivot.position.set(h.p.x - side * inset, y, 0.03);
    pivot.add(capsule(r, len, mat));
    const hand = new Object3D();
    hand.position.y = -(len + r * 0.8);
    pivot.add(hand);
    rig.body.add(pivot);
    rig.arms[side < 0 ? "L" : "R"] = { pivot, hand, side };
  }
}

function feet(rig, { dx, size, mat }) {
  for (const s of [-1, 1]) {
    const f = ellipsoid(size, mat);
    f.position.set(s * dx, size[1] * 0.85, 0.05);
    rig.root.add(f);
  }
}

function newRig(c) {
  const root = new Group();
  const body = new Group();
  root.add(body);
  return { c, root, body, surfaces: [], arms: {}, sockets: {}, crownItems: [] };
}

function addSockets(rig, { crownY, eyesY, lapY, neckY, earY }) {
  rig.root.updateMatrixWorld(true);
  const s = rig.surfaces;
  const side = (k) => hit(s, new Vector3(k * 4, earY, 0), new Vector3(-k, 0, 0));
  rig.sockets = {
    crown: { p: new Vector3(0, crownY, 0), n: new Vector3(0, 1, 0) },
    eyes: front(s, 0, eyesY),
    "ear.L": side(-1),
    "ear.R": side(1),
    lap: front(s, 0, lapY),
    neck: front(s, 0, neckY),
  };
}

const BUILDERS = {
  pip(rig, col) {
    const body = lathe(eggProfile(1, 0.41, 0.12), clay(col.body));
    rig.body.add(body);
    rig.surfaces.push(body);
    rig.root.updateMatrixWorld(true);
    // Face pad: a puffy cream ellipsoid pressed into the egg, with a rolled clay rim.
    const zs = front([body], 0, 0.56).p.z;
    const pad = ellipsoid([0.265, 0.225, 0.13], clay(col.face, { gloss: 0.25 }));
    pad.position.set(0, 0.56, zs - 0.085);
    rig.body.add(pad);
    rig.root.updateMatrixWorld(true);
    const ring = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * PI * 2;
      const h = front([pad, body], Math.cos(a) * 0.272, 0.56 + Math.sin(a) * 0.232);
      ring.push(h.p.addScaledVector(h.n, 0.012));
    }
    rig.body.add(rope(ring, 0.03, clay(col.shade), true));
    rig.face = { targets: [pad, body], eyes: { y: 0.575, dx: 0.105, rx: 0.036, ry: 0.048 }, cheeks: { y: 0.49, dx: 0.175, rx: 0.05, ry: 0.032 }, mouth: { y: 0.505, w: 0.06 } };
    // Sprout.
    const leaf = clay(col.leaf, { gloss: 0.4 });
    const sprout = new Group();
    sprout.add(rope([new Vector3(0, 0.99, 0), new Vector3(-0.004, 1.06, 0), new Vector3(0.018, 1.13, 0)], 0.017, leaf));
    const l1 = ellipsoid([0.07, 0.022, 0.04], leaf);
    l1.position.set(-0.05, 1.14, 0);
    l1.rotation.z = 0.5;
    const l2 = ellipsoid([0.085, 0.024, 0.045], leaf);
    l2.position.set(0.09, 1.16, 0);
    l2.rotation.z = -0.42;
    sprout.add(l1, l2);
    rig.body.add(sprout);
    rig.crownItems.push(sprout);
    const shade = clay(col.shade);
    arms(rig, { y: 0.46, r: 0.07, len: 0.12, inset: 0.035, mat: clay(col.body) });
    feet(rig, { dx: 0.155, size: [0.12, 0.065, 0.15], mat: shade });
    addSockets(rig, { crownY: 1.03, eyesY: 0.575, lapY: 0.24, neckY: 0.3, earY: 0.6 });
    rig.H = 1.03;
    rig.top = 1.2;
    rig.halfW = 0.41;
  },

  mochi(rig, col) {
    const body = lathe(eggProfile(0.8, 0.5, 0.2, 0.72, 0.02), clay(col.body));
    rig.body.add(body);
    rig.surfaces.push(body);
    rig.root.updateMatrixWorld(true);
    const tip = lathe((t) => [0.13 * Math.sin(t * PI * 0.5 + PI * 0.5) * (1 - t * 0.15), 0.2 * t], clay(col.body));
    tip.position.set(0.015, 0.76, 0);
    tip.rotation.z = -0.5;
    rig.body.add(tip);
    const b = front([body], 0, 0.21);
    const belly = ellipsoid([0.27, 0.15, 0.1], clay(col.belly, { gloss: 0.25 }));
    belly.position.copy(b.p).addScaledVector(b.n, -0.055);
    belly.lookAt(belly.position.clone().add(b.n));
    rig.body.add(belly);
    rig.face = { targets: [body], eyes: { y: 0.47, dx: 0.13, rx: 0.044, ry: 0.058 }, cheeks: { y: 0.375, dx: 0.235, rx: 0.06, ry: 0.036 }, mouth: { y: 0.39, w: 0.068 } };
    arms(rig, { y: 0.3, r: 0.078, len: 0.1, inset: 0.04, mat: clay(col.body) });
    feet(rig, { dx: 0.19, size: [0.12, 0.055, 0.13], mat: clay(col.shade) });
    addSockets(rig, { crownY: 0.82, eyesY: 0.47, lapY: 0.2, neckY: 0.27, earY: 0.5 });
    rig.H = 0.82;
    rig.top = 0.98;
    rig.halfW = 0.5;
  },

  quill(rig, col) {
    const fleece = clay(col.fleece, { gloss: 0.22 });
    const body = lathe(eggProfile(0.8, 0.36, 0.1), fleece);
    rig.body.add(body);
    const hoodMat = clay(col.hood);
    const hood = ellipsoid([0.43, 0.4, 0.41], hoodMat);
    hood.position.set(0, 0.72, 0);
    rig.body.add(hood);
    rig.surfaces.push(hood, body);
    rig.root.updateMatrixWorld(true);
    const zs = front([hood], 0, 0.66).p.z;
    const pad = ellipsoid([0.235, 0.2, 0.12], clay(col.fleece, { gloss: 0.22 }));
    pad.position.set(0, 0.665, zs - 0.075);
    rig.body.add(pad);
    rig.root.updateMatrixWorld(true);
    const ring = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * PI * 2;
      const h = front([pad, hood], Math.cos(a) * 0.243, 0.665 + Math.sin(a) * 0.208);
      ring.push(h.p.addScaledVector(h.n, 0.012));
    }
    rig.body.add(rope(ring, 0.032, clay(col.hoodShade), true));
    for (const s of [-1, 1]) {
      const ear = sphere(0.1, hoodMat);
      ear.position.set(s * 0.25, 1.05, -0.03);
      const inner = ellipsoid([0.052, 0.052, 0.025], fleece);
      inner.position.set(s * 0.25, 1.05, 0.065);
      rig.body.add(ear, inner);
    }
    rig.root.updateMatrixWorld(true);
    const cord = clay(col.hoodShade);
    for (const s of [-1, 1]) {
      const r = surfaceRope([hood, body], (u) => [s * (0.075 + (u + 1) * 0.006), 0.35 - (u + 1) * 0.04], 0.012, cord, 0.004, 8);
      rig.body.add(r);
      const bead = sphere(0.026, clay(col.bead, { gloss: 0.6 }));
      const end = front([body], s * 0.087, 0.265);
      bead.position.copy(end.p).addScaledVector(end.n, 0.03);
      rig.body.add(bead);
    }
    rig.face = { targets: [pad, hood], eyes: { y: 0.68, dx: 0.095, rx: 0.033, ry: 0.044 }, cheeks: { y: 0.6, dx: 0.155, rx: 0.046, ry: 0.03 }, mouth: { y: 0.612, w: 0.052 } };
    arms(rig, { y: 0.37, r: 0.066, len: 0.1, inset: 0.03, mat: fleece });
    feet(rig, { dx: 0.14, size: [0.11, 0.06, 0.14], mat: clay(col.fleeceShade) });
    addSockets(rig, { crownY: 1.12, eyesY: 0.68, lapY: 0.2, neckY: 0.3, earY: 0.72 });
    rig.H = 1.15;
    rig.top = 1.16;
    rig.halfW = 0.43;
  },

  memo(rig, col) {
    const body = roundedBox(0.84, 0.92, 0.38, 0.17, clay(col.body));
    body.position.y = 0.5;
    rig.body.add(body);
    rig.surfaces.push(body);
    rig.root.updateMatrixWorld(true);
    const line = clay(col.lines, { gloss: 0.2 });
    for (const [y, w] of [[0.36, 0.44], [0.285, 0.34]]) {
      rig.body.add(surfaceRope([body], (u) => [u * w * 0.5, y], 0.016, line, 0.002, 10));
    }
    // A chunky paper clip over the top edge.
    const clip = clay(col.clip, { gloss: 0.7, rough: 0.35, sheen: 0.1 });
    const loop = [[-0.05, 0.8, 0.2], [-0.05, 1.0, 0.2], [0.05, 1.0, 0.2], [0.05, 0.84, 0.2], [0.05, 0.84, 0.21]];
    const clipFront = rope(loop.map(([x, y, z]) => new Vector3(x, y, z)), 0.018, clip);
    const clipBack = rope([new Vector3(-0.05, 0.98, 0.2), new Vector3(-0.05, 1.0, 0.1), new Vector3(-0.05, 0.95, -0.2), new Vector3(-0.05, 0.84, -0.2)], 0.018, clip);
    const g = new Group();
    g.add(clipFront, clipBack);
    g.position.x = -0.2;
    rig.body.add(g);
    rig.face = { targets: [body], eyes: { y: 0.63, dx: 0.105, rx: 0.038, ry: 0.05 }, cheeks: { y: 0.535, dx: 0.19, rx: 0.052, ry: 0.032 }, mouth: { y: 0.55, w: 0.06 } };
    arms(rig, { y: 0.45, r: 0.068, len: 0.11, inset: 0.03, mat: clay(col.body) });
    feet(rig, { dx: 0.17, size: [0.11, 0.06, 0.14], mat: clay(col.shade) });
    addSockets(rig, { crownY: 0.96, eyesY: 0.63, lapY: 0.24, neckY: 0.42, earY: 0.63 });
    rig.H = 0.96;
    rig.top = 1.02;
    rig.halfW = 0.42;
  },
};

/** Arm angles in degrees: z = outward (0 hangs down), x = forward. */
export const POSES = {
  rest: { L: [18, 0], R: [18, 0] },
  wave: { L: [18, 0], R: [148, 0] },
  think: { L: [16, 0], R: [-28, -118] },
  type: { L: [-12, -72], R: [-12, -72] },
  hold: { L: [-22, -58], R: [-22, -58] },
  sleep: { L: [6, 0], R: [6, 0], tilt: -7 },
  celebrate: { L: [150, -10], R: [150, -10], lift: 0.09 },
};

export function buildCharacter(id, { expr = "neutral", pose = "rest" } = {}) {
  const c = byId[id];
  const rig = newRig(c);
  BUILDERS[id](rig, c.colors);
  rig.root.updateMatrixWorld(true);
  const face = buildFace(rig.face, expr, c.colors.cheek);
  face.traverse((o) => {
    o.userData.face = true;
  });
  rig.body.add(face);
  const p = POSES[pose];
  for (const k of ["L", "R"]) {
    const { pivot, side } = rig.arms[k];
    pivot.rotation.set(MathUtils.degToRad(p[k][1]), 0, side * MathUtils.degToRad(p[k][0]), "XYZ");
  }
  if (p.tilt) rig.body.rotation.z = MathUtils.degToRad(p.tilt);
  if (p.lift) rig.root.position.y = p.lift;
  rig.root.updateMatrixWorld(true);
  return rig;
}
