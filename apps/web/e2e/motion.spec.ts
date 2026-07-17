import { MOTIONS } from "./motion/catalog.ts";
import { moved, movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";
import { traceMotion } from "./helpers/trace.ts";
import { expect, test } from "./helpers/test.ts";

// Frame time is asserted only where frames are real (the Mac, headed, GPU: MOTION_FRAMES=1).
// Layout and paint inside the animated subtree are deterministic and asserted everywhere.
const assertFrames = process.env.MOTION_FRAMES === "1";
test.use({ video: process.env.MOTION_VIDEO === "1" ? "on" : "off" });

test.describe("D28 motion: compositor-only, with a reduced-motion variant", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "motion checks run once");

  for (const motion of MOTIONS) {
    test(`${motion.id}: no layout or paint in the animated subtree`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await motion.open(page);
      const verdict = await traceMotion(page, motion);
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
      expect(await movingAnimations(page, motion.scope)).toEqual([]);
      if (motion.sample) {
        const samples = await readSamples(page, motion.id, 30);
        expect(new Set(samples.filter(moved)).size, "a rAF spring moved").toBeLessThanOrEqual(1);
      }
    });
  }
});
