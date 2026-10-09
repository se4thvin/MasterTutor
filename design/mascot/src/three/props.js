// State props in clay: thought bubbles, Z letters, wave arcs, confetti. Added to the rig root.
import { Group, Vector3 } from "three";
import { clay, roundedBox, sphere, torus } from "./shapes.js";

function letterZ(size, mat) {
  const g = new Group();
  const t = size * 0.24;
  const bar = (y) => {
    const b = roundedBox(size, t, t * 0.9, t * 0.45, mat);
    b.position.y = y;
    return b;
  };
  const diag = roundedBox(size * 1.25, t, t * 0.9, t * 0.45, mat);
  diag.rotation.z = Math.atan2(size - t, size - t * 0.2);
  g.add(bar(size / 2 - t / 2), bar(-size / 2 + t / 2), diag);
  return g;
}

/** Deterministic pseudo-random, so renders are repeatable. */
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export const PROPS = {
  bubbles(rig) {
    const g = new Group();
    const white = clay("#ffffff", { gloss: 0.35 });
    const w = rig.halfW;
    const t = rig.top;
    for (const [x, y, r] of [[w * 0.8, t - 0.02, 0.028], [w * 1.0, t + 0.09, 0.04], [w * 1.22, t + 0.22, 0.055]]) {
      const s = sphere(r, white);
      s.position.set(x, y, 0.2);
      g.add(s);
    }
    const c = new Vector3(w * 1.55, t + 0.44, 0.08);
    for (const [x, y, r] of [[-0.13, 0, 0.11], [0, 0.05, 0.14], [0.13, 0, 0.11], [-0.06, -0.06, 0.1], [0.07, -0.06, 0.1]]) {
      const s = sphere(r, white);
      s.position.set(c.x + x, c.y + y, c.z);
      g.add(s);
    }
    const ink = clay("#636366", { gloss: 0.5 });
    for (const dx of [-0.07, 0, 0.07]) {
      const d = sphere(0.021, ink);
      d.position.set(c.x + dx, c.y + 0.0, c.z + 0.135);
      g.add(d);
    }
    return g;
  },
  zzz(rig) {
    const g = new Group();
    const m = clay("#a7b8dc", { gloss: 0.4 });
    const w = rig.halfW;
    const t = rig.top;
    for (const [x, y, s] of [[w * 0.75, t - 0.06, 0.075], [w * 1.0, t + 0.1, 0.1], [w * 1.32, t + 0.31, 0.13]]) {
      const z = letterZ(s, m);
      z.position.set(x, y, 0.15);
      z.rotation.z = 0.22;
      g.add(z);
    }
    return g;
  },
  wave(rig) {
    const g = new Group();
    const hand = rig.arms.R.hand.getWorldPosition(new Vector3());
    const m = clay("#aeaeb2", { gloss: 0.3 });
    for (const r of [0.11, 0.17]) {
      const arc = torus(r, 0.014, 1.1, m);
      arc.position.copy(hand).add(new Vector3(-0.02, 0, 0.05));
      arc.rotation.z = -0.55;
      g.add(arc);
    }
    return g;
  },
  confetti(rig) {
    const g = new Group();
    const rand = rng(7);
    const colors = ["#2f8cf0", "#ffcc4d", "#ff7f5e", "#34c759", "#f0457a", "#ffffff"].map((h) => clay(h, { gloss: 0.5 }));
    const w = rig.halfW;
    for (let i = 0; i < 30; i++) {
      const a = rand() * Math.PI * 2;
      const r = w * (1.15 + rand() * 0.75);
      const x = Math.cos(a) * r;
      const y = rig.top * 0.62 + Math.sin(a) * r * 0.75 + 0.1;
      if (y < 0.08) continue;
      const m = colors[i % colors.length];
      const piece = i % 3 === 0 ? sphere(0.022, m) : roundedBox(0.055, 0.026, 0.01, 0.005, m);
      piece.position.set(x, y, 0.1 + rand() * 0.25);
      piece.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      g.add(piece);
    }
    return g;
  },
};
