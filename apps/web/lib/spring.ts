/** Damped spring with unit mass (run 16 prototype), shared by the 3D hero and Pip. Parameters come from motion-tokens. */
export interface Spring {
  x: number;
  v: number;
  target: number;
  stiffness: number;
  damping: number;
}

export function createSpring(x: number, p: { stiffness: number; damping: number }): Spring {
  return { x, v: 0, target: x, stiffness: p.stiffness, damping: p.damping };
}

function stepSpring(s: Spring, dt: number): void {
  s.v += (-s.stiffness * (s.x - s.target) - s.damping * s.v) * dt;
  s.x += s.v * dt;
}

const SUBSTEP = 1 / 240;

/** Fixed substeps keep k=400 stable on long frames. */
export function stepSprings(springs: readonly Spring[], dt: number): void {
  const n = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / n;
  for (let i = 0; i < n; i++) for (const s of springs) stepSpring(s, h);
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
