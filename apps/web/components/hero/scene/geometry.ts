import { ExtrudeGeometry, LatheGeometry, Shape, Vector2 } from "three";

/** Rounded-rectangle slab centred on z, with face-spanning UVs (prototype `slab`). */
export function slab(
  w: number,
  h: number,
  r: number,
  depth: number,
  bevel: number,
): ExtrudeGeometry {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  g.translate(0, 0, -depth / 2);
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  return g;
}

/** Left-anchored pill so scale.x grows it like a line being written. */
export function bar(w: number, h: number, depth = 0.012): ExtrudeGeometry {
  const g = slab(w, h, Math.min(h / 2, 0.05), depth, 0);
  g.translate(w / 2, 0, 0);
  return g;
}

export function lathe(
  points: readonly (readonly [number, number])[],
  segments = 128,
): LatheGeometry {
  return new LatheGeometry(
    points.map(([x, y]) => new Vector2(x, y)),
    segments,
  );
}
