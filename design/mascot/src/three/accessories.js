// Chunky clay accessories. Each attaches through one named socket only, so any accessory fits
// any concept: { socket, takesCrown?, pose?, build(rig) → Object3D in body space }.
import { Group, PointLight, Vector3 } from "three";
import { clay, ellipsoid, front, glow, gloss, lathe, rope, roundedBox, sphere, stick, torus } from "./shapes.js";

const navy = () => clay("#2b3a8f");
const graphite = () => clay("#3a3a3c", { gloss: 0.5, rough: 0.5 });
const alu = () => clay("#dcdce0", { gloss: 0.8, rough: 0.35, sheen: 0.1 });

export const ACCESSORIES = {
  glasses: {
    socket: "eyes",
    build(rig) {
      const g = new Group();
      const { y, dx, ry } = rig.face.eyes;
      const frame = gloss("#1d1d1f");
      const r = ry * 1.75;
      const pts = [];
      for (const s of [-1, 1]) {
        const h = front(rig.face.targets, s * dx, y);
        const ring = stick(torus(r, 0.014, Math.PI * 2, frame), h, 0.045);
        g.add(ring);
        pts.push(ring.position.clone().add(new Vector3(-s * r, 0.006, 0.004)));
      }
      const mid = pts[0].clone().lerp(pts[1], 0.5).add(new Vector3(0, 0.014, 0.012));
      g.add(rope([pts[0], mid, pts[1]], 0.011, frame));
      return g;
    },
  },
  beret: {
    socket: "crown",
    takesCrown: true,
    build(rig) {
      const g = new Group();
      const cap = ellipsoid([0.25, 0.08, 0.24], navy());
      const nub = sphere(0.028, navy());
      nub.position.y = 0.08;
      const band = torus(0.2, 0.026, Math.PI * 2, clay("#1c2766"));
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.03;
      g.add(cap, nub, band);
      g.position.copy(rig.sockets.crown.p).add(new Vector3(0.04, 0.015, 0));
      g.rotation.z = -0.24;
      return g;
    },
  },
  headphones: {
    socket: "ear.L/ear.R",
    build(rig) {
      const g = new Group();
      const L = rig.sockets["ear.L"].p;
      const R = rig.sockets["ear.R"].p;
      const y = (L.y + R.y) / 2;
      const radius = (R.x - L.x) / 2 + 0.035;
      const band = torus(radius, 0.03, Math.PI, graphite());
      band.scale.y = (rig.sockets.crown.p.y + 0.05 - y) / radius;
      band.position.set(0, y, 0);
      g.add(band);
      for (const s of [-1, 1]) {
        const cup = ellipsoid([0.06, 0.1, 0.088], graphite());
        cup.position.set(s * (radius + 0.01), y, 0);
        const dot = ellipsoid([0.01, 0.034, 0.034], clay("#2997ff", { gloss: 0.8 }));
        dot.position.set(s * (radius + 0.068), y, 0);
        g.add(cup, dot);
      }
      return g;
    },
  },
  bowtie: {
    socket: "neck",
    build(rig) {
      const g = stick(new Group(), rig.sockets.neck, 0.03);
      const m = clay("#ff5533", { gloss: 0.45 });
      for (const s of [-1, 1]) {
        const lobe = ellipsoid([0.075, 0.055, 0.035], m);
        lobe.position.x = s * 0.06;
        lobe.rotation.z = s * 0.25;
        g.add(lobe);
      }
      const knot = sphere(0.032, m);
      knot.position.z = 0.012;
      g.add(knot);
      return g;
    },
  },
  book: {
    socket: "lap",
    pose: "hold",
    build(rig) {
      const g = stick(new Group(), rig.sockets.lap, 0.13);
      g.rotation.x -= 0.2;
      const cover = roundedBox(0.3, 0.23, 0.05, 0.02, clay("#e0482d"));
      const spine = roundedBox(0.03, 0.235, 0.055, 0.012, clay("#a3200f"));
      spine.position.x = -0.15;
      const label = roundedBox(0.14, 0.035, 0.012, 0.008, clay("#ffe3d6"));
      label.position.set(0.02, 0.04, 0.028);
      const ribbon = roundedBox(0.02, 0.06, 0.008, 0.004, clay("#2f8cf0"));
      ribbon.position.set(0.08, -0.115, 0.02);
      g.add(cover, spine, label, ribbon);
      g.position.y += 0.06;
      return g;
    },
  },
  laptop: {
    socket: "lap",
    pose: "type",
    build(rig) {
      const g = new Group();
      const lap = rig.sockets.lap.p;
      g.position.set(0, lap.y - 0.03, lap.z + 0.11);
      const base = roundedBox(0.42, 0.035, 0.28, 0.014, alu());
      g.add(base);
      const hinge = new Group();
      hinge.position.set(0, 0.015, 0.13);
      hinge.rotation.x = -0.32;
      const lid = roundedBox(0.42, 0.25, 0.024, 0.014, alu());
      lid.position.y = 0.125;
      const screen = roundedBox(0.38, 0.21, 0.006, 0.004, glow("#7cc0ff", 0.9));
      screen.position.set(0, 0.125, -0.012);
      const logo = ellipsoid([0.022, 0.022, 0.006], glow("#ffffff", 0.6));
      logo.position.set(0, 0.13, 0.013);
      const light = new PointLight("#6fb6ff", 0.5, 0.9, 1.6);
      light.position.set(0, 0.18, -0.12);
      hinge.add(lid, screen, logo, light);
      g.add(hinge);
      return g;
    },
  },
  orb: {
    socket: "lap",
    pose: "hold",
    build(rig) {
      const g = stick(new Group(), rig.sockets.lap, 0.15);
      g.position.y += 0.07;
      const orb = sphere(0.1, glow("#bff0ec", 0.9));
      orb.castShadow = false;
      const halo = sphere(0.13, glow("#a9dcd8", 0.5));
      halo.material.transparent = true;
      halo.material.opacity = 0.16;
      halo.material.depthWrite = false;
      halo.castShadow = false;
      const light = new PointLight("#a9fff6", 0.8, 1.0, 1.6);
      g.add(orb, halo, light);
      return g;
    },
  },
  partyHat: {
    socket: "crown",
    takesCrown: true,
    build(rig) {
      const g = new Group();
      const cone = lathe((t) => [0.11 * (1 - t), 0.26 * t], clay("#ffcc4d"));
      const stripe = torus(0.075, 0.016, Math.PI * 2, clay("#2f8cf0"));
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = 0.085;
      const pom = sphere(0.045, clay("#ffffff"));
      pom.position.y = 0.27;
      g.add(cone, stripe, pom);
      g.position.copy(rig.sockets.crown.p).add(new Vector3(0.02, -0.03, 0));
      g.rotation.z = -0.28;
      return g;
    },
  },
};

export function attach(rig, names) {
  for (const name of names) {
    const a = ACCESSORIES[name];
    if (a.takesCrown) for (const item of rig.crownItems) item.visible = false;
    rig.body.add(a.build(rig));
  }
}
