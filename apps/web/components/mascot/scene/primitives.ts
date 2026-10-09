import {
  CapsuleGeometry,
  LatheGeometry,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * Shared geometry: every ellipsoid is one unit sphere scaled, every rounded box and capsule is
 * built once per shape. All Pips on a page share these buffers; only transforms differ.
 */
const cache = new Map<string, BufferGeometry>();
const once = (key: string, make: () => BufferGeometry) => {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
};

export const unitSphere = () => once("sphere", () => new SphereGeometry(1, 28, 18));

export function mesh(geometry: BufferGeometry, material: Material, shadow = true): Mesh {
  const m = new Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

export function ellipsoid(r: readonly [number, number, number], material: Material, shadow = true) {
  const m = mesh(unitSphere(), material, shadow);
  m.scale.set(r[0], r[1], r[2]);
  return m;
}

export const sphere = (r: number, material: Material, shadow = true) =>
  ellipsoid([r, r, r], material, shadow);

export function roundedBox(w: number, h: number, d: number, r: number, material: Material) {
  return mesh(
    once(`box:${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r)),
    material,
  );
}

/** A capsule hanging from its top cap's centre (the pivot is the origin). */
export function hangingCapsule(radius: number, length: number, material: Material) {
  const geometry = once(`capsule:${radius}:${length}`, () => {
    const g = new CapsuleGeometry(radius, length, 6, 16);
    g.translate(0, -length / 2, 0);
    return g;
  });
  return mesh(geometry, material);
}

/** A capsule centred on its origin along +y. */
export function capsule(radius: number, length: number, material: Material) {
  return mesh(
    once(`capsule-c:${radius}:${length}`, () => new CapsuleGeometry(radius, length, 4, 10)),
    material,
  );
}

export function torus(radius: number, tube: number, arc: number, material: Material) {
  return mesh(
    once(`torus:${radius}:${tube}:${arc}`, () => new TorusGeometry(radius, tube, 10, 40, arc)),
    material,
  );
}

/** A lathe from fn(t ∈ [0, 1]) → [radius, y], bottom to top. */
export function lathe(
  key: string,
  profile: (t: number) => [number, number],
  steps: number,
  segments: number,
  material: Material,
) {
  return mesh(
    once(`lathe:${key}`, () => {
      const points: Vector2[] = [];
      for (let i = 0; i <= steps; i++) {
        const [r, y] = profile(i / steps);
        points.push(new Vector2(Math.max(r, 0), y));
      }
      // Seam at the back (phiStart π), never seen from the front.
      return new LatheGeometry(points, segments, Math.PI);
    }),
    material,
  );
}

export function triangleCount(geometry: BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.attributes["position"]!.count) / 3;
}
