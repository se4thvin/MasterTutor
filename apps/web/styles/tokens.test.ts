import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS_REM } from "../lib/breakpoints.ts";

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function blockAfter(marker: string): Record<string, string> {
  const at = tokens.indexOf(marker);
  if (at < 0) throw new Error(`missing ${marker}`);
  const open = tokens.indexOf(":root {", at);
  const body = tokens.slice(tokens.indexOf("{", open) + 1, tokens.indexOf("}", open));
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}

type Rgba = [number, number, number, number];
function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\((\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] ? Number(rgb[4]) : 1];
  throw new Error(`unparseable colour ${value}`);
}
const over = (fg: Rgba, bg: Rgba): Rgba => [
  fg[0] * fg[3] + bg[0] * (1 - fg[3]),
  fg[1] * fg[3] + bg[1] * (1 - fg[3]),
  fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  1,
];
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgba) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [text token, background token]; alpha backgrounds are composited over --bg. */
const PAIRS: Array<[string, string]> = [
  ["label", "bg"],
  ["label-2", "bg"],
  ["label-2", "bg-2"],
  ["label-2", "elevated"],
  ["label-2", "glass"],
  ["label-2", "glass-side"],
  ["label-2", "fill"],
  ["label-2", "fill-2"],
  ["label", "fill"],
  ["label", "fill-2"],
  ["tint-text", "bg"],
  ["tint-text", "tint-wash"],
  ["on-tint", "tint"],
  ["signal", "bg"],
  ["signal", "signal-wash"],
  ["on-signal", "signal"],
  ["ok", "bg"],
  ["ok", "ok-wash"],
  ["warn", "bg"],
  ["warn", "warn-wash"],
  ["danger", "bg"],
  ["danger", "danger-wash"],
  ["on-danger", "danger"],
  ["code-keyword", "bg-2"],
  ["code-number", "bg-2"],
  ["code-title", "bg-2"],
  ["code-string", "bg-2"],
  ["code-comment", "bg-2"],
];

describe.each([
  ["light", blockAfter("/* light */")],
  ["dark", blockAfter("prefers-color-scheme: dark")],
])("%s tokens", (_scheme, vars) => {
  it.each(PAIRS)("%s on %s meets WCAG AA (4.5:1)", (fg, bg) => {
    const base = parseColor(vars["bg"] ?? "");
    const back = over(parseColor(vars[bg] ?? ""), base);
    const text = over(parseColor(vars[fg] ?? ""), back);
    expect(contrast(text, back)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("tokens", () => {
  it("uses the D25 background", () => {
    expect(blockAfter("/* light */")["bg"]).toBe("#fafafa");
  });
  it("keeps Tailwind breakpoints equal to lib/breakpoints.ts", () => {
    for (const [name, rem] of Object.entries(BREAKPOINTS_REM)) {
      expect(globals).toContain(`--breakpoint-${name}: ${rem}rem;`);
    }
  });
});
