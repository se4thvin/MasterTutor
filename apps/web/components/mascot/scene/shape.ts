/**
 * Pip's proportions (3d-readiness.md §1–3), in body units: 1 u is the body's height, the ground
 * is y = 0, +z faces the viewer. The egg is a surface of revolution, so every socket and the face
 * rim are solved analytically here instead of ray-cast at load.
 */
export const EGG = { radius: 0.41, bulge: 0.12, base: 0.03, height: 1 } as const;
export const PAD = { y: 0.56, rx: 0.265, ry: 0.225, rz: 0.13, inset: 0.085 } as const;
export const CROWN_Y = EGG.base + EGG.height;
export const COLORS = {
  body: "#55b8b5",
  shade: "#1f8f96",
  face: "#fff4e6",
  leaf: "#34c759",
  cheek: "#ff8f87",
  eye: "#1d1d1f",
  mouth: "#5b2626",
  tongue: "#ff8f87",
} as const;

/** The egg's profile at angle a ∈ [0, π]: [radius, height]. */
export function eggProfile(a: number): [number, number] {
  return [
    EGG.radius * Math.sin(a) * (1 + EGG.bulge * Math.cos(a)),
    EGG.base + (EGG.height * (1 - Math.cos(a))) / 2,
  ];
}

/** The egg's radius at height y (0 outside the egg). */
function eggRadius(y: number): number {
  const c = 1 - (2 * (y - EGG.base)) / EGG.height;
  if (c <= -1 || c >= 1) return 0;
  return eggProfile(Math.acos(c))[0];
}

/** The outward normal of the egg at height y, in its (radial, up) plane, normalised. */
function eggNormal(y: number): [number, number] {
  const h = 1e-3;
  const dr = (eggRadius(y + h) - eggRadius(y - h)) / (2 * h);
  const len = Math.hypot(1, dr);
  return [1 / len, -dr / len];
}

/** The egg's front surface z at (x, y), or 0 outside it. */
function eggFrontZ(x: number, y: number): number {
  const r = eggRadius(y);
  return r > Math.abs(x) ? Math.sqrt(r * r - x * x) : 0;
}

/** Centre z of the face pad: pressed into the egg so it bulges about 0.045 u. */
export const PAD_Z = eggFrontZ(0, PAD.y) - PAD.inset;

/** The pad's front surface z at (x, y), or -Infinity outside its outline. */
function padFrontZ(x: number, y: number): number {
  const k = 1 - (x / PAD.rx) ** 2 - ((y - PAD.y) / PAD.ry) ** 2;
  return k > 0 ? PAD_Z + PAD.rz * Math.sqrt(k) : -Infinity;
}

/** The front of the body + pad union at (x, y). */
export const frontZ = (x: number, y: number) => Math.max(eggFrontZ(x, y), padFrontZ(x, y));

export interface Socket {
  position: [number, number, number];
  /** The outward surface normal (the socket's +z for front sockets). */
  normal: [number, number, number];
}

function frontSocket(y: number): Socket {
  const [nr, ny] = eggNormal(y);
  return { position: [0, y, eggFrontZ(0, y)], normal: [0, ny, nr] };
}

function sideSocket(side: -1 | 1, y: number): Socket {
  const [nr, ny] = eggNormal(y);
  return { position: [side * eggRadius(y), y, 0], normal: [side * nr, ny, 0] };
}

/** Accessory sockets in body space (3d-readiness.md §3). */
export const SOCKETS = {
  crown: { position: [0, CROWN_Y, 0], normal: [0, 1, 0] } as Socket,
  eyes: { position: [0, 0.575, padFrontZ(0, 0.575)], normal: [0, 0, 1] } as Socket,
  "ear.L": sideSocket(-1, 0.6),
  "ear.R": sideSocket(1, 0.6),
  lap: frontSocket(0.24),
  neck: frontSocket(0.3),
} as const;

/** Arm pivots: just inside the egg's side at shoulder height. */
export const ARM = { y: 0.46, radius: 0.07, length: 0.12, inset: 0.035, z: 0.03 } as const;
export const armPivotX = (side: -1 | 1) => side * (eggRadius(ARM.y) - ARM.inset);

/** Face features, body units (the vector face shader draws these). */
export const FACE = {
  eyes: { y: 0.575, dx: 0.105, rx: 0.036, ry: 0.048 },
  cheeks: { y: 0.49, dx: 0.175, rx: 0.05, ry: 0.032 },
  mouth: { y: 0.505 },
} as const;

/** Frame boxes per size: centre and half extent (body units) the camera fits. */
export const FRAMING = {
  hero: { cx: 0.08, cy: 0.62, half: 0.84 },
  compact: { cx: 0, cy: 0.64, half: 0.7 },
} as const;
