import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { durations } from "../lib/motion-tokens.ts";

/** Every press target (D21), with the scale it should press to. */
const PRESS_TARGETS = {
  "--motion-press": [".btn", ".rseg-item", ".toast-action"],
  "--motion-press-icon": [".icon-btn", ".chip-x", ".toast-close"],
  "--motion-press-row": [
    ".card",
    ".nav-item",
    ".tree-row",
    ".move-row",
    ".menu-item",
    ".row-link",
    ".recent-item",
    ".callout",
    ".src-pick",
  ],
} as const;

const dir = new URL("./", import.meta.url);
const sheets = readdirSync(dir)
  .filter((f) => f.endsWith(".css") && f !== "motion.css" && f !== "tokens.css")
  .map((f) => ({ name: f, css: readFileSync(new URL(f, dir), "utf8") }));
const components = sheets.find((s) => s.name === "components.css")?.css ?? "";

/** The selector list of the rule that sets `--press-scale: var(<token>)`. */
function targetsFor(token: string): string[] {
  const rule = new RegExp(`([^{}]+)\\{\\s*--press-scale:\\s*var\\(${token}\\);`).exec(components);
  return (rule?.[1] ?? "").match(/\.[\w-]+/g) ?? [];
}

describe("press feedback (D21): one shared rule", () => {
  it.each(Object.entries(PRESS_TARGETS))("%s covers every listed target", (token, targets) => {
    expect(targetsFor(token).sort()).toEqual([...targets].sort());
  });

  it("presses with the independent scale property, only on :active, and never when disabled", () => {
    expect(components).toMatch(
      /:active:not\(:disabled, \[aria-disabled="true"\]\)\s*\{\s*scale:\s*var\(--press-scale\)/,
    );
  });

  it("transitions scale within 100ms and swaps it for a dim under reduced motion", () => {
    expect(durations.press).toBeLessThan(100);
    expect(components).toMatch(/transition-duration:\s*var\(--motion-dur-press\)/);
    expect(components).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*:active[^{]*\{\s*scale:\s*none;\s*opacity:/,
    );
  });

  it("leaves no per-component :active transform copies behind", () => {
    for (const { name, css } of sheets) {
      expect(css, name).not.toMatch(/&:active[^{]*\{\s*transform:\s*scale/);
    }
  });
});
