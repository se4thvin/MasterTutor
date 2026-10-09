import { expect, type Page } from "@playwright/test";
import { seriousA11yViolations } from "./a11y.ts";
import { findLayoutIssues, type LayoutQaOptions } from "./layout-qa.ts";

/** Waits for fonts, finite animations and toast fade-ins, so a check sees the settled screen. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Only running document-timeline animations can finish: scroll()/view() timelines never do,
    // and a paused one (a hovered or focused toast countdown) waits for the user, not for us.
    // A toast's countdown fuse is a timer, not settling motion: waiting for it would only start
    // the toast's exit fade, which axe would then measure mid-way.
    const finite = document
      .getAnimations()
      .filter(
        (a) =>
          a.timeline === document.timeline &&
          a.playState !== "paused" &&
          a.effect?.getTiming().iterations !== Infinity &&
          !((a.effect as KeyframeEffect | null)?.target as Element | null)?.matches(".toast-fuse"),
      );
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
    // Toasts (and their list item) fade in on motion values (rAF, not WAAPI), so wait until each is
    // fully shown, counting every ancestor's opacity as axe's contrast check does.
    const shown = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        if (getComputedStyle(node).opacity !== "1") return false;
      }
      return true;
    };
    const deadline = performance.now() + 2000;
    while (![...document.querySelectorAll(".toast")].every(shown) && performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
    }
    // Motion's springs and exits run on requestAnimationFrame and write inline styles; an exiting
    // element (a caption crossfading out) stays mounted until its exit ends. Wait until no inline
    // style changes and no element comes or goes for two frames, counted in frames rather than
    // wall time so a busy host waits longer instead of checking mid-exit (bounded at 300 frames for
    // a rAF loop that never rests).
    const snapshot = () =>
      [...document.querySelectorAll("[style]")].map((el) => el.getAttribute("style")).join("|") +
      `#${document.getElementsByTagName("*").length}`;
    let previous = snapshot();
    for (let frames = 0, still = 0; still < 2 && frames < 300; frames++) {
      await new Promise(requestAnimationFrame);
      const next = snapshot();
      still = next === previous ? still + 1 : 0;
      previous = next;
    }
  });
}

/** Layout QA plus axe in light and dark (D22). Reduced motion makes the settled layout immediate. */
export async function expectCleanScreen(page: Page, options: LayoutQaOptions = {}): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await settle(page);
    expect(await findLayoutIssues(page, options), `${colorScheme} layout`).toEqual([]);
    expect(await seriousA11yViolations(page), `${colorScheme} accessibility`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
}
