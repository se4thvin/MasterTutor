import { readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- guard test inspects the whole module namespace
import * as motionReact from "motion/react";
import { describe, expect, it } from "vitest";
import { renderMotionCss, sampleSpring } from "../scripts/generate-motion-css.ts";
import { durations, springs, transitions } from "./motion-tokens.ts";

describe("motion tokens", () => {
  it("settles the main spring in about 450ms (spec §11.4)", () => {
    const { durationMs, values } = sampleSpring(springs.spring);
    expect(durationMs).toBeGreaterThanOrEqual(400);
    expect(durationMs).toBeLessThanOrEqual(520);
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    expect(Math.max(...values)).toBeGreaterThan(1);
  });

  it("keeps the soft spring slower than the main one", () => {
    expect(sampleSpring(springs.springSoft).durationMs).toBeGreaterThan(
      sampleSpring(springs.spring).durationMs,
    );
  });

  it("expresses tween durations in seconds for motion", () => {
    expect(transitions.micro.duration).toBe(durations.micro / 1000);
    expect(transitions.spring).toBe(springs.spring);
  });

  it("matches the committed styles/motion.css (run motion:css after editing tokens)", () => {
    const committed = readFileSync(new URL("../styles/motion.css", import.meta.url), "utf8");
    expect(committed).toBe(renderMotionCss());
  });

  it("emits a linear() spring and a reduced-motion fallback", () => {
    const css = renderMotionCss();
    expect(css).toMatch(/--motion-spring: linear\(0, [^)]*, 1\);/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("under reduced motion no animation waits on a delay (I-3: a delayed from-frame is a snap)", () => {
    const reduce = renderMotionCss().split("@media (prefers-reduced-motion: reduce)")[1] ?? "";
    // -1ms with the 1ms duration: no offset from-frame is ever painted, staggered or not.
    expect(reduce).toContain("animation-delay: -1ms !important;");
  });

  it("leaves scroll-linked animations on their scroll mapping under reduced motion", () => {
    const reduce = renderMotionCss().split("@media (prefers-reduced-motion: reduce)")[1] ?? "";
    expect(reduce).toMatch(/\.toolbar::after \{\s*animation-delay: 0s !important;/);
  });

  it("still exports every motion API this app uses (motion 12 to 14 guard)", () => {
    for (const name of [
      "LazyMotion",
      "domAnimation",
      "domMax",
      "m",
      "animate",
      "useMotionValue",
      "useTransform",
      "useMotionValueEvent",
      "useReducedMotion",
      "MotionConfig",
      "AnimatePresence",
    ]) {
      expect(motionReact, name).toHaveProperty(name);
    }
  });
});
