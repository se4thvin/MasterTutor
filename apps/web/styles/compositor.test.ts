import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Spec §11.4 / D28: animate transform and opacity only; nothing animates layout or filter. */
const COMPOSITOR = new Set(["transform", "opacity", "translate", "scale", "rotate"]);
const LAYOUT_OR_FILTER =
  /^(?:all|width|height|min-|max-|top|left|right|bottom|inset|margin|padding|border-width|font-size|line-height|grid-|flex-basis|filter|backdrop-filter)/;

const dir = new URL("./", import.meta.url);
const sheets = readdirSync(dir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => ({ file: f, text: readFileSync(new URL(f, dir), "utf8") }));

/** The text between a `{` at `open` and its matching `}`. */
function block(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

/** Splits on commas outside parentheses (cubic-bezier(…), var(…)). */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    if (value[i] === ")") depth--;
    if (value[i] === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, value.slice(start)].map((p) => p.trim()).filter(Boolean);
}

export function keyframeProperties(text: string): { name: string; property: string }[] {
  return [...text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].flatMap((m) =>
    [...block(text, m.index + m[0].length - 1).matchAll(/([a-z-]+)\s*:\s*[^;{}]+;/g)].map((d) => ({
      name: m[1]!,
      property: d[1]!,
    })),
  );
}

export function transitionedProperties(text: string): string[] {
  return [...text.matchAll(/transition(-property)?\s*:\s*([^;{}]+);/g)].flatMap((m) =>
    splitTopLevel(m[2]!).map((item) => item.split(/\s+/)[0]!),
  );
}

describe("compositor-only motion in CSS (D28, P8-29)", () => {
  it("the parsers see what they should (self-test)", () => {
    const css = `@keyframes a { from { opacity: 0; width: 1px } } .x { transition: transform var(--d) cubic-bezier(0.4, 0, 0.2, 1), height 1s; }`;
    expect(keyframeProperties(css).map((k) => k.property)).toEqual(["opacity"]);
    expect(transitionedProperties(css)).toEqual(["transform", "height"]);
  });

  it("every @keyframes animates compositor properties only", () => {
    const bad = sheets.flatMap(({ file, text }) =>
      keyframeProperties(text)
        .filter((k) => !COMPOSITOR.has(k.property))
        .map((k) => `${file} @keyframes ${k.name}: ${k.property}`),
    );
    expect(bad).toEqual([]);
  });

  it("no transition animates layout, filter or `all`", () => {
    const bad = sheets.flatMap(({ file, text }) =>
      transitionedProperties(text)
        .filter((p) => LAYOUT_OR_FILTER.test(p))
        .map((p) => `${file}: transition ${p}`),
    );
    expect(bad).toEqual([]);
  });
});
