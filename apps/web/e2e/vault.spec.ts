import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("vault explains the model, lists sign-ins with sealed fields, and is clean everywhere", async ({
  page,
}) => {
  await page.goto("/vault");
  await expect(page.getByRole("heading", { level: 1, name: /Vault/ })).toBeVisible();
  await expect(page.getByText("Sees an alias.")).toBeVisible();
  const rows = page.getByRole("list", { name: "Sign-ins" }).locator(".vrow");
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({ hasText: "github" })).toContainText("Password");
  await expect(rows.filter({ hasText: "github" })).toContainText("sealed");
  await expect(page.getByRole("heading", { name: "Secrets are never shown." })).toBeVisible();
  await expectCleanScreen(page);
});

test("signing out of a saved session is optimistic", async ({ page }) => {
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "github" });
  await expect(row).toContainText("Session saved");
  await row.getByRole("button", { name: "Sign out of github" }).click();
  await expect(row).toContainText("Signs in on next use");
});
