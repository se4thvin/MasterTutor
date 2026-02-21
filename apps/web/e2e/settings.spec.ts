import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("settings groups are clean at every width", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: /Settings/ })).toBeVisible();
  for (const name of ["Safety", "Defaults for new tasks", "Agent", "Activity", "Account"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByText("6 browsers at once")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expectCleanScreen(page);
});

test("kill switch asks before stopping everything and shows the banner", async ({ page }) => {
  await page.goto("/settings");
  const kill = page.getByRole("switch", { name: "Kill switch" });
  await kill.click();
  const alert = page.getByRole("alertdialog", { name: "Stop all runs?" });
  await expect(alert.getByRole("button", { name: "Keep Running" })).toBeFocused();
  await expectCleanScreen(page);
  await alert.getByRole("button", { name: "Stop All Runs" }).click();
  await expect(kill).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "Kill switch is on." })).toBeVisible();
  await kill.click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(kill).not.toBeChecked();
});

test("cancelling the kill switch confirm leaves it off", async ({ page }) => {
  await page.goto("/settings");
  const kill = page.getByRole("switch", { name: "Kill switch" });
  await kill.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep Running" }).click();
  await expect(kill).not.toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "Kill switch is on." })).toBeHidden();
});

test("a failed kill switch change rolls back and says so", async ({ page }) => {
  await page.route("**/api/rpc/settings/setKillSwitch", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto("/settings");
  const kill = page.getByRole("switch", { name: "Kill switch" });
  await kill.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Stop All Runs" }).click();
  await expect(
    page.getByRole("group").filter({ hasText: "Couldn't change the kill switch." }),
  ).toBeVisible();
  await expect(kill).not.toBeChecked();
});

test("edits default budget and allowed websites, normalising origins", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Save defaults" })).toBeHidden();
  await page.getByLabel("Max steps").fill("90");
  await page.getByLabel("Add a website").fill("Learn.ZyBooks.com/zybook/x");
  await page.getByLabel("Add a website").press("Enter");
  await expect(page.getByText("https://learn.zybooks.com")).toBeVisible();
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByRole("group").filter({ hasText: "Defaults saved" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save defaults" })).toBeHidden();
  await page.reload();
  await expect(page.getByLabel("Max steps")).toHaveValue("90");
  await expect(page.getByText("https://learn.zybooks.com")).toBeVisible();
  await page.getByLabel("Max steps").fill("0");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Use 1–10,000 steps.")).toBeVisible();
});

test("an invalid website is refused and Revert restores the saved defaults", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Add a website").fill("javascript:alert(1)");
  await page.getByLabel("Add a website").press("Enter");
  await expect(page.getByText("Enter a website such as example.com.")).toBeVisible();
  await page.getByLabel("Max steps").fill("7");
  await page.getByRole("button", { name: "Revert" }).click();
  await expect(page.getByLabel("Max steps")).not.toHaveValue("7");
  await expect(page.getByRole("button", { name: "Revert" })).toBeHidden();
});

test("activity links lead to Usage and the Audit log", async ({ page }) => {
  await page.goto("/settings");
  const activity = page.getByRole("navigation", { name: "Activity" });
  await expect(activity.getByRole("link", { name: "Usage" })).toHaveAttribute(
    "href",
    "/settings/usage",
  );
  await expect(activity.getByRole("link", { name: "Audit log" })).toHaveAttribute(
    "href",
    "/settings/audit",
  );
});
