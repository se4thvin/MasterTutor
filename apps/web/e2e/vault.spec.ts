import { movingAnimations } from "./helpers/motion.ts";
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

test("the sign-in count appears only once the list has loaded", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/rpc/vault/list", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/vault");
  const heading = page.getByRole("heading", { level: 2, name: /^Sign-ins/ });
  await expect(page.getByRole("status", { name: "Loading sign-ins" })).toBeVisible();
  await expect(heading).toHaveText("Sign-ins");
  release();
  await expect(heading).toHaveText("Sign-ins · 5");
});

test("a failed sign-out restores the session and says so", async ({ page }) => {
  await page.route("**/api/rpc/vault/forgetSession", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "github" });
  await row.getByRole("button", { name: "Sign out of github" }).click();
  await expect(page.getByRole("group").filter({ hasText: "Couldn't sign out." })).toBeVisible();
  await expect(row).toContainText("Session saved");
});

test("the session mark turns from saved to pending when you sign out", async ({ page }) => {
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "github" });
  await expect(row.locator('.vrow-session .smark[data-status="done"]')).toBeVisible();
  await row.getByRole("button", { name: "Sign out of github" }).click();
  await expect(row.locator('.vrow-session .smark[data-status="pending"]')).toBeVisible();
  await expect(row).toContainText("Signs in on next use");
  // A toast has just appeared: expectCleanScreen waits for it to settle before axe (m-6).
  await expectCleanScreen(page);
});

test("under reduced motion the session mark only fades", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "github" });
  await row.getByRole("button", { name: "Sign out of github" }).click();
  await expect(row.locator('.smark[data-status="pending"]')).toBeVisible();
  expect(await movingAnimations(page, ".vrow-session")).toEqual([]);
});
