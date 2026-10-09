import {
  CatmullRomCurve3,
  Group,
  Mesh,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import { PIP_ACCESSORIES, type PipAccessory } from "../pip-types.ts";
import { ACCESSORIES } from "./accessories.ts";
import { clay } from "./clay.ts";
import { PAD_CENTER, faceMaterial, type FaceUniforms } from "./face.ts";
import { capsule, ellipsoid, hangingCapsule, lathe, mesh, triangleCount } from "./primitives.ts";
import { bubbles, confetti, sweatDrop, zzz, type Confetti } from "./props.ts";
import { ARM, COLORS, CROWN_Y, EGG, PAD, armPivotX, eggProfile, frontZ } from "./shape.ts";
import { contactShadow } from "./studio.ts";

/**
 * Pip's rig (3d-readiness.md §2): an object hierarchy, no bones. The template is built once per
 * page and cloned per Pip, so every Pip shares geometry and clay materials; only the face
 * material (its expression uniforms) and the laptop screen are per Pip.
 *
 *   pip
 *   ├─ root (ground, between the feet): hop, squash and stretch
 *   │  ├─ body (pivot near the base): breathing, lean, look turn
 *   │  │  └─ frame (body units): egg, pad, rim, arms, sockets, held items, hats, props
 *   │  └─ feet
 *   ├─ sprout (world space, simulated: two stem segments and two leaves)
 *   ├─ confetti (instanced, Pip space)
 *   └─ contact shadow
 */
export interface PipRig {
  group: Group;
  root: Group;
  body: Group;
  crown: Object3D;
  arms: { L: Group; R: Group };
  accessories: Record<PipAccessory, Object3D>;
  /** State props that are also accessories share one object: laptop, book, party hat. */
  props: { bubbles: Group; zzz: Group; sweat: Group; confetti: Confetti };
  sprout: { segments: [Mesh, Mesh]; leaves: [Group, Group] };
  shadow: Mesh;
  face: FaceUniforms;
  screen: MeshStandardMaterial | null;
  /** Materials this Pip owns (the rest are shared). */
  own: Material[];
}

const BODY_PIVOT_Y = EGG.base;
const STEM_RADIUS = 0.017;

function buildTemplate(): Group {
  const body = clay(COLORS.body);
  const shade = clay(COLORS.shade);
  const leaf = clay(COLORS.leaf, { gloss: 0.4 });

  const pip = new Group();
  pip.name = "pip";
  const root = new Group();
  root.name = "root";
  const bodyPivot = new Group();
  bodyPivot.name = "body";
  bodyPivot.position.y = BODY_PIVOT_Y;
  const frame = new Group();
  frame.position.y = -BODY_PIVOT_Y;
  bodyPivot.add(frame);
  root.add(bodyPivot);
  pip.add(root);

  // Egg body: 48 × 32 lathe, the seam at the back.
  const egg = lathe("egg", (t) => eggProfile(t * Math.PI), 32, 48, body);
  egg.name = "egg";
  frame.add(egg);

  // Face pad (its own dense sphere: the face is drawn in its fragment shader).
  const pad = mesh(new SphereGeometry(1, 44, 30), faceMaterial());
  pad.name = "pad";
  pad.scale.set(PAD.rx, PAD.ry, PAD.rz);
  pad.position.set(...PAD_CENTER);
  frame.add(pad);

  // The rolled rim: a closed tube just outside the pad's outline, on the egg's surface.
  const ring: Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const x = Math.cos(a) * (PAD.rx + 0.007);
    const y = PAD.y + Math.sin(a) * (PAD.ry + 0.007);
    ring.push(new Vector3(x, y, frontZ(x, y) + 0.006));
  }
  const rim = mesh(
    new TubeGeometry(new CatmullRomCurve3(ring, true, "centripetal"), 96, 0.03, 8, true),
    shade,
  );
  frame.add(rim);

  // Arms: capsules hanging from shoulder pivots.
  for (const [name, side] of [
    ["arm.L", -1],
    ["arm.R", 1],
  ] as const) {
    const pivot = new Group();
    pivot.name = name;
    pivot.position.set(armPivotX(side), ARM.y, ARM.z);
    pivot.add(hangingCapsule(ARM.radius, ARM.length, body));
    frame.add(pivot);
  }

  const crown = new Group();
  crown.name = "crown";
  crown.position.y = CROWN_Y;
  frame.add(crown);

  // Feet stay planted on the root, so the body can lean and hop without sliding them.
  for (const side of [-1, 1]) {
    const foot = ellipsoid([0.12, 0.065, 0.15], shade);
    foot.position.set(side * 0.155, 0.055, 0.05);
    root.add(foot);
  }

  for (const name of PIP_ACCESSORIES) {
    const item = ACCESSORIES[name].build();
    item.name = `acc:${name}`;
    item.visible = false;
    frame.add(item);
  }
  for (const [name, prop] of [
    ["prop:bubbles", bubbles()],
    ["prop:zzz", zzz()],
    ["prop:sweat", sweatDrop()],
  ] as const) {
    prop.name = name;
    prop.visible = false;
    frame.add(prop);
  }

  // Sprout: two stem segments and two leaves on pivots at the tip, posed from the simulation.
  const sprout = new Group();
  sprout.name = "sprout";
  for (const i of [0, 1]) {
    const segment = capsule(STEM_RADIUS, 0.07, leaf);
    segment.name = `stem${i}`;
    sprout.add(segment);
  }
  for (const [i, side, r] of [
    [0, -1, [0.07, 0.022, 0.04]],
    [1, 1, [0.085, 0.024, 0.045]],
  ] as const) {
    const pivot = new Group();
    pivot.name = `leaf${i}`;
    const blade = ellipsoid(r, leaf);
    blade.position.x = side * r[0] * 0.92;
    pivot.add(blade);
    sprout.add(pivot);
  }
  pip.add(sprout);

  const shadow = contactShadow();
  shadow.name = "shadow";
  pip.add(shadow);
  return pip;
}

let template: Group | null = null;

/** A new Pip: a clone of the shared template with its own face and screen materials. */
export function createRig(): PipRig {
  template ??= buildTemplate();
  const group = template.clone(true);
  const find = <T extends Object3D>(name: string) => group.getObjectByName(name) as T;
  const pad = find<Mesh>("pad");
  const face = faceMaterial();
  pad.material = face;
  let screen: MeshStandardMaterial | null = null;
  const screenMesh = find<Mesh>("screen");
  if (screenMesh) {
    screen = (screenMesh.material as MeshStandardMaterial).clone();
    screenMesh.material = screen;
  }
  const c = confetti();
  c.mesh.visible = false;
  group.add(c.mesh);
  const accessories = Object.fromEntries(
    PIP_ACCESSORIES.map((name) => [name, find(`acc:${name}`)]),
  ) as Record<PipAccessory, Object3D>;
  return {
    group,
    root: find("root"),
    body: find("body"),
    crown: find("crown"),
    arms: { L: find("arm.L"), R: find("arm.R") },
    accessories,
    props: {
      bubbles: find("prop:bubbles"),
      zzz: find("prop:zzz"),
      sweat: find("prop:sweat"),
      confetti: c,
    },
    sprout: {
      segments: [find("stem0"), find("stem1")],
      leaves: [find("leaf0"), find("leaf1")],
    },
    shadow: find("shadow"),
    face: face.userData.face,
    screen,
    own: screen ? [face, screen] : [face],
  };
}

/** Frees a Pip's own materials (shared geometry and clay stay for the next Pip). */
export function disposeRig(rig: PipRig): void {
  for (const material of rig.own) material.dispose();
  rig.props.confetti.mesh.dispose();
}

/** Triangles and draw calls of the base Pip (no accessories or props), for the report. */
export function measureRig(): { triangles: number; meshes: number } {
  template ??= buildTemplate();
  let triangles = 0;
  let meshes = 0;
  template.traverse((o) => {
    if (!(o instanceof Mesh) || o.name === "shadow") return;
    let hidden = false;
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) hidden = true;
    if (hidden) return;
    meshes++;
    triangles += triangleCount(o.geometry);
  });
  return { triangles: Math.round(triangles), meshes };
}
