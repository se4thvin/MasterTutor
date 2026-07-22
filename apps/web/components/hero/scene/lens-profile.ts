interface LensDims {
  radius: number;
  halfHeight: number;
  edge: number;
  dome: number;
}
export const LENS: LensDims = { radius: 1, halfHeight: 0.22, edge: 0.17, dome: 0.06 };

/** Lathe profile of the Capture Lens puck: flat base, rounded rim, slightly domed top. */
export function lensProfile({ radius: R, halfHeight: H, edge: E, dome: D }: LensDims = LENS): [
  number,
  number,
][] {
  const pts: [number, number][] = [[0.001, -H]];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * (Math.PI / 2);
    pts.push([R - E + E * Math.cos(a), -H + E + E * Math.sin(a)]);
  }
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    pts.push([R - E + E * Math.cos(a), H - E + E * Math.sin(a)]);
  }
  for (let i = 1; i <= 14; i++) {
    const x = (R - E) * (1 - i / 14);
    pts.push([Math.max(x, 0.001), H + D * (1 - (x / (R - E)) ** 2)]);
  }
  return pts;
}
