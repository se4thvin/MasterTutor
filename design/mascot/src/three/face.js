// Clay facial features stuck onto a face surface: glossy eye beans, rope lids and mouths,
// flattened blush discs. In the app these become a texture atlas (see 3d-readiness.md).
import { Group } from "three";
import { INK } from "../concepts.mjs";
import { clay, ellipsoid, front, gloss, glow, sphere, stick, surfaceRope } from "./shapes.js";

const mats = () => ({
  eye: gloss(INK.eye),
  shine: glow("#ffffff", 1.2),
  line: clay(INK.eye, { gloss: 0.6, rough: 0.4, sheen: 0 }),
  mouth: clay(INK.mouth, { gloss: 0.5, rough: 0.45, sheen: 0 }),
  tongue: clay(INK.tongue, { gloss: 0.4 }),
});

function eyeBean(t, m, x, y, rx, ry) {
  const h = front(t, x, y);
  const g = stick(new Group(), h, 0.004);
  g.add(ellipsoid([rx, ry, rx * 0.55], m.eye));
  const s = sphere(rx * 0.32, m.shine);
  s.position.set(-rx * 0.32, ry * 0.4, rx * 0.5);
  const s2 = sphere(rx * 0.14, m.shine);
  s2.position.set(rx * 0.35, -ry * 0.38, rx * 0.5);
  g.add(s, s2);
  return g;
}

export function buildFace(f, expr, cheekHex = "#ff8f87") {
  const m = mats();
  const t = f.targets;
  const g = new Group();
  const { y, dx, rx, ry } = f.eyes;
  for (const s of [-1, 1]) {
    const x = s * dx;
    if (expr === "happy") g.add(surfaceRope(t, (u) => [x + u * rx * 1.3, y - ry * 0.35 + ry * 0.85 * (1 - u * u)], 0.013, m.line));
    else if (expr === "sleepy") g.add(surfaceRope(t, (u) => [x + u * rx * 1.3, y - ry * 0.1 - ry * 0.5 * (1 - u * u)], 0.012, m.line));
    else if (expr === "thinking") g.add(eyeBean(t, m, x + 0.008, y + 0.012, rx, ry * 0.92));
    else if (expr === "focused") g.add(eyeBean(t, m, x, y - 0.012, rx, ry * 0.7));
    else g.add(eyeBean(t, m, x, y, rx, ry));
  }
  if (expr === "thinking") {
    g.add(surfaceRope(t, (u) => [dx + u * rx * 1.4, y + ry * 1.75 + 0.012 * (1 - u * u) + u * 0.006], 0.01, m.line));
  }
  const { y: my, w } = f.mouth;
  if (expr === "happy") {
    const h = front(t, 0, my - w * 0.18);
    const mouth = stick(new Group(), h, 0.002);
    mouth.add(ellipsoid([w * 0.55, w * 0.42, 0.016], m.mouth));
    const tongue = ellipsoid([w * 0.3, w * 0.15, 0.012], m.tongue);
    tongue.position.set(0, -w * 0.2, 0.008);
    mouth.add(tongue);
    g.add(mouth);
  } else if (expr === "sleepy") {
    g.add(stick(ellipsoid([0.014, 0.017, 0.01], m.mouth), front(t, 0, my - 0.005), 0.003));
  } else if (expr === "thinking") {
    g.add(surfaceRope(t, (u) => [u * w * 0.32 + w * 0.12, my - 0.004 + u * 0.006], 0.01, m.line, 0.006, 6));
  } else {
    const k = expr === "focused" ? 0.6 : 1;
    g.add(surfaceRope(t, (u) => [u * w * 0.5 * k, my + 0.006 - w * 0.32 * k * (1 - u * u)], 0.0105, m.line, 0.006, 10));
  }
  const cheek = clay(cheekHex, { gloss: 0.15, sheen: 0.2 });
  const { y: cy, dx: cdx, rx: crx, ry: cry } = f.cheeks;
  const grow = expr === "happy" ? 1.12 : 1;
  for (const s of [-1, 1]) {
    const h = front(t, s * cdx, cy);
    g.add(stick(ellipsoid([crx * grow, cry * grow, 0.012], cheek), h, -0.002));
  }
  return g;
}
