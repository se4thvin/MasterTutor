import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("design-system page is clean at every breakpoint (F1 done-when)", async ({ page }) => {
  await page.goto("/design");
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  await expect(page.locator('[data-qa="design-section"]').first()).toBeVisible();
  await expect(page.getByRole("img", { name: "verified" })).toBeVisible();
  await expectCleanScreen(page);
});
