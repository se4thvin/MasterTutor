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
    ".ftile",
    ".thread-peek",
    ".th-replay",
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
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*:active[^{]*\{\s*scale:\s*1;\s*opacity:/,
    );
  });

  // A scale of none is no transform: going to or from it changes the element's containing block,
  // so Chromium lays it out again at the press and when the release ends (QA-015). At rest every
  // target holds scale 1, so a press only changes the transform's value.
  it("keeps every target at scale 1 at rest, so a press never relays out", () => {
    const rest = /:where\(([^)]*)\)\s*\{[^}]*\bscale:\s*1;/.exec(components);
    const targets = Object.values(PRESS_TARGETS).flat();
    expect((rest?.[1]?.match(/\.[\w-]+/g) ?? []).sort()).toEqual([...targets].sort());
    expect(components).not.toMatch(/\bscale:\s*none\b/);
  });

  it("leaves no per-component :active transform copies behind", () => {
    for (const { name, css } of sheets) {
      expect(css, name).not.toMatch(/&:active[^{]*\{\s*transform:\s*scale/);
    }
  });
});
