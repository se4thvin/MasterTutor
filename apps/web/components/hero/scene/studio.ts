import { Color } from "three";

export function isDarkColor(css: string): boolean {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(css).getHSL(hsl);
  return hsl.l < 0.5;
}

export function studioTones(dark: boolean): { wall: number; floor: number } {
  return dark ? { wall: 0.16, floor: 0.04 } : { wall: 0.42, floor: 0.1 };
}
