import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("design-system page is clean at every breakpoint (F1 done-when)", async ({ page }) => {
  await page.goto("/design");
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  await expect(page.locator('[data-qa="design-section"]').first()).toBeVisible();
  await expect(page.getByRole("img", { name: "verified" })).toBeVisible();
  await expectCleanScreen(page);
});

test("controls give press feedback and keep switches keyboard-operable", async ({ page }) => {
  await page.goto("/design#controls");
  const toggle = page.getByRole("switch", { name: "Show callouts" });
  await expect(toggle).toBeChecked();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("p[role=alert]")).toHaveText("Enter a website such as example.com.");
});
