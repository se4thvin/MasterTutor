import type { Page } from "@playwright/test";
import { MOTIONS } from "./motion/catalog.ts";
import { moved, movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";
import { traceMotion } from "./helpers/trace.ts";
import { expect, test } from "./helpers/test.ts";

// Frame time is asserted only where frames are real (the Mac, headed, GPU: MOTION_FRAMES=1).
// Layout and paint are attributed per element (invalidation tracking) and counted from two frames
// after the trigger to the end mark, so the same motion gives the same zero or non-zero verdict on
// every run. The positive control proves the harness sees layout and paint at all (I6).
const assertFrames = process.env.MOTION_FRAMES === "1";
test.use({ video: process.env.MOTION_VIDEO === "1" ? "on" : "off" });

test.describe("D28 motion: compositor-only, with a reduced-motion variant", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "motion checks run once");

  // The harness's own controls (I6): it must see layout and paint where they happen, and see none
  // for transform-only motion, on the main thread or the compositor.
  const control = async (page: Page, css: string, js: "spin" | "none") => {
    await page.setContent(`
      <style>.box { width: 40px; height: 40px; background-color: red } ${css}</style>
      <div class="scope"><div class="box"></div></div><p>Static text</p>`);
    return traceMotion(page, {
      scope: ".scope",
      trigger: async (p) =>
        p.locator(".box").evaluate((el, spin) => {
          el.classList.add("on");
          if (!spin) return;
          let x = 0;
          const step = () => {
            x = (x + 5) % 300;
            (el as HTMLElement).style.transform = `translateX(${x}px)`;
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }, js === "spin"),
      durationMs: 400,
    });
  };

  test("control: width and background-color animations are caught", async ({ page }) => {
    const verdict = await control(
      page,
      `.box.on { animation: grow 600ms linear infinite alternate }
       @keyframes grow { to { width: 400px; background-color: blue } }`,
      "none",
    );
    expect(verdict.layouts, "layout frames").toBeGreaterThan(5);
    expect(verdict.paints, "paint frames").toBeGreaterThan(5);
  });

  test("control: transform-only motion counts zero, CSS or rAF", async ({ page }) => {
    const css = await control(
      page,
      `.box.on { animation: slide 600ms linear infinite alternate }
       @keyframes slide { to { transform: translateX(300px) } }`,
      "none",
    );
    expect(css).toMatchObject({ layouts: 0, paints: 0 });
    expect(await control(page, "", "spin")).toMatchObject({ layouts: 0, paints: 0 });
  });

  for (const motion of MOTIONS) {
    test(`${motion.id}: no layout or paint in the animated subtree`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await motion.open(page);
      const verdict = await traceMotion(page, motion);
      test.info().annotations.push({ type: "verdict", description: JSON.stringify(verdict) });
      expect(verdict.layouts, "layout in the animated subtree").toBe(0);
      expect(verdict.paints, "paint in the animated subtree").toBe(0);
      if (assertFrames) {
        expect(verdict.frames, "frames recorded").toBeGreaterThan(0);
        expect(verdict.longFrames, `worst frame ${verdict.worstFrameMs} ms`).toBe(0);
      }
    });

    test(`${motion.id}: nothing moves under reduced motion`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await motion.open(page);
      if (motion.sample)
        await startSampling(page, motion.id, motion.sample.selector, motion.sample.property, 30);
      await motion.trigger(page);
      await motion.settled?.(page);
      expect(await movingAnimations(page, motion.scope)).toEqual([]);
      if (motion.sample) {
        const samples = await readSamples(page, motion.id, 30);
        expect(new Set(samples.filter(moved)).size, "a rAF spring moved").toBeLessThanOrEqual(1);
      }
    });
  }
});
