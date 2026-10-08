import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./helpers/test.ts";

/** Holds the pointer down on the element and reads what the press did to it. */
async function pressed(page: Page, target: Locator): Promise<{ scale: string; opacity: string }> {
  // hover() scrolls the target into view and puts the pointer on it.
  await target.hover();
  await page.mouse.down();
  // Read the pressed state once the press transition has finished, by its own end, not a fixed
  // wait: on a busy host a 90ms transition can still be running after 150ms (0.920004).
  const style = await target.evaluate(async (el) => {
    await new Promise(requestAnimationFrame); // :active applies, and starts the transition
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const s = getComputedStyle(el);
    return { scale: s.scale, opacity: s.opacity };
  });
  // Release away from the target, so the press never becomes a click.
  await page.mouse.move(1, 1);
  await page.mouse.up();
  return style;
}

test.describe("press feedback", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "computed style check runs once");

  test("buttons, rows and icon controls scale while pressed", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("Add a website").fill("example.com");
    await page.getByLabel("Add a website").press("Enter");
    const cases: Array<[Locator, string]> = [
      [page.getByRole("button", { name: "Sign out" }), "0.96"],
      [page.getByRole("link", { name: "Usage" }), "0.98"],
      [page.getByRole("button", { name: "Remove https://example.com" }), "0.92"],
    ];
    for (const [target, scale] of cases) {
      expect((await pressed(page, target)).scale, (await target.textContent()) ?? "").toBe(scale);
    }
    await page.goto("/library");
    const card = page.locator('[data-qa="note-card"]').first();
    await expect(card).toBeVisible();
    expect((await pressed(page, card)).scale).toBe("0.98");
  });

  test("reduced motion dims instead of scaling", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/settings");
    const result = await pressed(page, page.getByRole("link", { name: "Usage" }));
    // Scale 1 at rest and when pressed: no scaling, and no transform added or removed (QA-015).
    expect(result.scale).toBe("1");
    expect(Number(result.opacity)).toBeLessThan(1);
  });
});
