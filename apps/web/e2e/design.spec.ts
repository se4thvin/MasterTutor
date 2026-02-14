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

test("overlays trap focus, default to the safe action, and close with Escape", async ({ page }) => {
  await page.goto("/design#overlays");
  await page.getByRole("button", { name: "Open sheet" }).click();
  const sheet = page.getByRole("dialog", { name: "Move to…" });
  await expect(sheet).toBeVisible();
  await expectCleanScreen(page);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.getByRole("button", { name: "Delete folder…" }).click();
  const alert = page.getByRole("alertdialog", { name: "Delete “Papers”?" });
  await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
  await alert.getByRole("button", { name: "Delete Folder" }).click();
  await expect(page.getByText("Deleted", { exact: true })).toBeVisible();

  await page.locator("#overlays").getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Show provenance" }).click();
  await expect(page.getByRole("dialog", { name: "Block provenance" })).toBeVisible();
});
