// Clay primitives and surface helpers. `setDetail("app")` builds the low-poly version the app
// would ship; "render" is the smooth version used for the concept renders.
import {
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const DETAIL = {
  render: { sphere: [64, 48], lathe: [72, 56], capsule: [12, 28], tube: [64, 14], box: 7, torus: [20, 64] },
  app: { sphere: [16, 12], lathe: [24, 16], capsule: [4, 10], tube: [20, 6], box: 2, torus: [6, 16] },
};
let D = DETAIL.render;
export const setDetail = (name) => {
  D = DETAIL[name];
};

/** Matte clay with a soft clearcoat, sheen and a touch of warm "subsurface" glow. */
export function clay(hex, { gloss = 0.32, rough = 0.68, sheen = 0.55 } = {}) {
  const color = new Color(hex);
  const warm = color.clone().lerp(new Color("#ff9a6a"), 0.35);
  return new MeshPhysicalMaterial({
    color,
    roughness: rough,
    metalness: 0,
    clearcoat: gloss,
    clearcoatRoughness: 0.42,
    sheen,
    sheenRoughness: 0.55,
    sheenColor: color.clone().lerp(new Color("#ffffff"), 0.55),
    emissive: warm,
    emissiveIntensity: 0.045,
  });
}

export const gloss = (hex) =>
  new MeshPhysicalMaterial({ color: hex, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
export const glow = (hex, intensity = 1.6) =>
  new MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.4 });

export function mesh(geometry, material) {
  const m = new Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function ellipsoid([x, y, z], material) {
  const m = mesh(new SphereGeometry(1, D.sphere[0], D.sphere[1]), material);
  m.scale.set(x, y, z);
  return m;
}
export const sphere = (r, material) => ellipsoid([r, r, r], material);

/** Capsule hanging from its top cap: the origin is the pivot. */
export function capsule(r, length, material) {
  const m = mesh(new CapsuleGeometry(r, length, D.capsule[0], D.capsule[1]), material);
  m.position.y = -length / 2;
  return m;
}

/** Lathe from a profile fn(t ∈ [0,1]) → [radius, y], bottom to top. */
export function lathe(profile, material) {
  const n = D.lathe[1];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const [r, y] = profile(i / n);
    pts.push(new Vector2(Math.max(r, 0), y));
  }
  // Seam at the back (phiStart π), so front-facing rays never land on it.
  return mesh(new LatheGeometry(pts, D.lathe[0], Math.PI), material);
}

export const roundedBox = (w, h, d, r, material) => mesh(new RoundedBoxGeometry(w, h, d, D.box, r), material);

export function torus(radius, tube, arc, material) {
  return mesh(new TorusGeometry(radius, tube, D.torus[0], D.torus[1], arc), material);
}

/** A soft rope through points, with round caps when open. */
export function rope(points, radius, material, closed = false) {
  const curve = new CatmullRomCurve3(points, closed, "centripetal");
  const m = mesh(new TubeGeometry(curve, D.tube[0], radius, D.tube[1], closed), material);
  if (!closed) {
    for (const p of [points[0], points.at(-1)]) {
      const cap = sphere(radius, material);
      cap.position.copy(p);
      m.add(cap);
    }
  }
  return m;
}

const ray = new Raycaster();
/** First hit on `targets` along a ray; returns the point and the outward normal (world space). */
export function hit(targets, origin, dir = new Vector3(0, 0, -1)) {
  ray.set(origin, dir.clone().normalize());
  const h = ray.intersectObjects(targets, false)[0];
  if (!h) return null;
  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
  return { p: h.point.clone(), n };
}
export const front = (targets, x, y) => hit(targets, new Vector3(x, y, 4));

const Z = new Vector3(0, 0, 1);
/** Places obj on a surface hit, its +z along the normal, lifted by `lift`. */
export function stick(obj, h, lift = 0) {
  obj.position.copy(h.p).addScaledVector(h.n, lift);
  obj.quaternion.setFromUnitVectors(Z, h.n);
  return obj;
}

/** A rope drawn on a surface: fn(u ∈ [-1,1]) → [x, y], projected from the front. */
export function surfaceRope(targets, fn, radius, material, lift = 0.006, steps = 12) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const [x, y] = fn(-1 + (2 * i) / steps);
    const h = front(targets, x, y);
    if (h) pts.push(h.p.addScaledVector(h.n, lift + radius * 0.4));
  }
  return rope(pts, radius, material);
}
