import { CatmullRomCurve3, Group, Quaternion, TubeGeometry, Vector3, type Object3D } from "three";
import type { PipAccessory } from "../pip-types.ts";
import { clay, glow } from "./clay.ts";
import { ellipsoid, lathe, mesh, roundedBox, sphere, torus } from "./primitives.ts";
import { FACE, SOCKETS, type Socket } from "./shape.ts";

/**
 * Chunky clay accessories, each authored around one socket (3d-readiness.md §3), in body space.
 * Every accessory is its own group, so personalisation only toggles which ones show.
 */
interface AccessoryDef {
  socket: keyof typeof SOCKETS;
  /** Hides the sprout (a hat on the crown). */
  takesCrown?: boolean;
  /** Held at the lap: the arms take this resting pose. */
  held?: "book" | "laptop";
  build(): Object3D;
}

const Z = new Vector3(0, 0, 1);

/** Places a group on a socket, its +z along the surface normal, lifted by `lift`. */
function onSocket(group: Group, socket: Socket, lift = 0): Group {
  const n = new Vector3(...socket.normal);
  group.position.set(...socket.position).addScaledVector(n, lift);
  group.quaternion.copy(new Quaternion().setFromUnitVectors(Z, n));
  return group;
}

const navy = () => clay("#2b3a8f");
const graphite = () => clay("#3a3a3c", { gloss: 0.5, rough: 0.5 });
const aluminium = () => clay("#dcdce0", { gloss: 0.8, rough: 0.35, sheen: 0.1 });

export const ACCESSORIES: Record<PipAccessory, AccessoryDef> = {
  glasses: {
    socket: "eyes",
    build() {
      const g = onSocket(new Group(), SOCKETS.eyes, 0.035);
      const frame = clay("#1d1d1f", { gloss: 1, rough: 0.25, sheen: 0 });
      const r = FACE.eyes.ry * 1.7;
      const y = FACE.eyes.y - SOCKETS.eyes.position[1];
      for (const s of [-1, 1]) {
        const ring = torus(r, 0.013, Math.PI * 2, frame);
        ring.position.set(s * FACE.eyes.dx, y, 0);
        g.add(ring);
      }
      const bridge = new CatmullRomCurve3([
        new Vector3(-FACE.eyes.dx + r, y + 0.006, 0),
        new Vector3(0, y + 0.02, 0.01),
        new Vector3(FACE.eyes.dx - r, y + 0.006, 0),
      ]);
      g.add(mesh(new TubeGeometry(bridge, 10, 0.01, 6), frame));
      return g;
    },
  },
  beret: {
    socket: "crown",
    takesCrown: true,
    build() {
      const g = new Group();
      const cap = ellipsoid([0.25, 0.08, 0.24], navy());
      const nub = sphere(0.028, navy());
      nub.position.y = 0.08;
      const band = torus(0.2, 0.026, Math.PI * 2, clay("#1c2766"));
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.03;
      g.add(cap, nub, band);
      g.position.set(SOCKETS.crown.position[0] + 0.04, SOCKETS.crown.position[1] + 0.015, 0);
      g.rotation.z = -0.24;
      return g;
    },
  },
  headphones: {
    socket: "ear.L",
    build() {
      const g = new Group();
      const L = SOCKETS["ear.L"].position;
      const R = SOCKETS["ear.R"].position;
      const y = (L[1] + R[1]) / 2;
      const radius = (R[0] - L[0]) / 2 + 0.035;
      const band = torus(radius, 0.03, Math.PI, graphite());
      band.scale.y = (SOCKETS.crown.position[1] + 0.05 - y) / radius;
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
    build() {
      const g = onSocket(new Group(), SOCKETS.neck, 0.03);
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
    held: "book",
    build() {
      // Held up in front of the tummy, its top tipped back toward Pip.
      const g = new Group();
      g.position.set(0, 0.34, SOCKETS.lap.position[2] + 0.13);
      g.rotation.x = -0.3;
      const cover = roundedBox(0.3, 0.23, 0.05, 0.02, clay("#e0482d"));
      const pages = roundedBox(0.272, 0.214, 0.036, 0.008, clay("#fbf5ea", { gloss: 0.1 }));
      pages.position.set(0.006, 0.01, -0.012);
      const spine = roundedBox(0.03, 0.235, 0.055, 0.012, clay("#a3200f"));
      spine.position.x = -0.15;
      const label = roundedBox(0.14, 0.035, 0.012, 0.006, clay("#ffe3d6"));
      label.position.set(0.02, 0.04, 0.028);
      const ribbon = roundedBox(0.02, 0.06, 0.008, 0.004, clay("#2f8cf0"));
      ribbon.position.set(0.08, -0.115, 0.02);
      ribbon.name = "ribbon";
      g.add(cover, pages, spine, label, ribbon);
      return g;
    },
  },
  laptop: {
    socket: "lap",
    held: "laptop",
    build() {
      const g = new Group();
      const lap = SOCKETS.lap.position;
      g.position.set(0, lap[1] + 0.02, lap[2] + 0.1);
      g.add(roundedBox(0.42, 0.035, 0.28, 0.014, aluminium()));
      const hinge = new Group();
      hinge.position.set(0, 0.015, 0.13);
      hinge.rotation.x = -0.32;
      const lid = roundedBox(0.42, 0.25, 0.024, 0.012, aluminium());
      lid.position.y = 0.125;
      const screen = roundedBox(0.38, 0.21, 0.006, 0.003, glow("#7cc0ff", 0.9));
      screen.position.set(0, 0.125, -0.013);
      screen.name = "screen";
      const logo = ellipsoid([0.022, 0.022, 0.005], glow("#ffffff", 0.5), false);
      logo.position.set(0, 0.13, 0.013);
      hinge.add(lid, screen, logo);
      g.add(hinge);
      return g;
    },
  },
  "party-hat": {
    socket: "crown",
    takesCrown: true,
    build() {
      const g = new Group();
      const cone = lathe("party-cone", (t) => [0.11 * (1 - t), 0.26 * t], 8, 28, clay("#ffcc4d"));
      const stripe = torus(0.075, 0.016, Math.PI * 2, clay("#2f8cf0"));
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = 0.085;
      const pom = sphere(0.045, clay("#ffffff"));
      pom.position.y = 0.27;
      g.add(cone, stripe, pom);
      g.position.set(SOCKETS.crown.position[0] + 0.02, SOCKETS.crown.position[1] - 0.03, 0);
      g.rotation.z = -0.28;
      return g;
    },
  },
};
