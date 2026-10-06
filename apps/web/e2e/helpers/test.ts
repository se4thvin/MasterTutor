import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { FIXTURE_AUTH_COOKIE, FIXTURE_NS_COOKIE } from "../../lib/fixtures/cookies.ts";
import { seriousA11yViolations } from "./a11y.ts";
import { findLayoutIssues } from "./layout-qa.ts";

export const test = base.extend<{ signedOut: boolean }>({
  signedOut: [false, { option: true }],
  context: async ({ context, baseURL, signedOut }, provide) => {
    const url = baseURL ?? "http://localhost:3100";
    const cookies: Array<{ name: string; value: string; url: string }> = [
      { name: FIXTURE_NS_COOKIE, value: randomUUID(), url },
    ];
    if (signedOut) cookies.push({ name: FIXTURE_AUTH_COOKIE, value: "signed-out", url });
    await context.addCookies(cookies);
    await provide(context);
  },
});

export { expect };

export const isCompact = (page: Page) => (page.viewportSize()?.width ?? 0) <= 820;
export const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) > 1180;

async function settle(page: Page): Promise<void> {
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
    // Toasts fade in on motion values (rAF, not WAAPI), so wait for them to be fully shown.
    const deadline = performance.now() + 2000;
    while (
      [...document.querySelectorAll(".toast")].some((t) => getComputedStyle(t).opacity !== "1") &&
      performance.now() < deadline
    ) {
      await new Promise(requestAnimationFrame);
    }
  });
}

/** Layout QA plus axe in light and dark (D22). Reduced motion makes the settled layout immediate. */
export async function expectCleanScreen(page: Page): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await settle(page);
    expect(await findLayoutIssues(page), `${colorScheme} layout`).toEqual([]);
    expect(await seriousA11yViolations(page), `${colorScheme} accessibility`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
}
