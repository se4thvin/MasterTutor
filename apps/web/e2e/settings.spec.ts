import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("settings groups are clean at every width", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: /Settings/ })).toBeVisible();
  for (const name of [
    "Safety",
    "Notifications",
    "Defaults for new tasks",
    "Agent",
    "Activity",
    "Account",
  ]) {
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

test("the kill switch is locked while a change is in flight", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/rpc/settings/setKillSwitch", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/settings");
  const kill = page.getByRole("switch", { name: "Kill switch" });
  await kill.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Stop All Runs" }).click();
  await expect(kill).toBeChecked();
  await expect(kill).toBeDisabled();
  release();
  await expect(kill).toBeEnabled();
  await expect(kill).toBeChecked();
});

test("a website typed but not added is saved with the defaults", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Add a website").fill("example.org/some/path");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByRole("group").filter({ hasText: "Defaults saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("https://example.org")).toBeVisible();
  await page.getByLabel("Add a website").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Enter a website such as example.com.")).toBeVisible();
});

test("a failed sign-out keeps the user here and says so", async ({ page }) => {
  await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 500, json: {} }));
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("group").filter({ hasText: "Couldn't sign out." })).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
});

test("settings that fail to load offer Retry instead of an endless skeleton", async ({ page }) => {
  let fail = true;
  await page.route("**/api/rpc/settings/get", (route) =>
    fail
      ? route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } })
      : route.continue(),
  );
  await page.goto("/settings");
  const error = page.getByRole("alert").filter({ hasText: "Couldn't load settings." });
  await expect(error).toBeVisible({ timeout: 10_000 });
  await expectCleanScreen(page);
  fail = false;
  await error.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("switch", { name: "Kill switch" })).toBeVisible();
});

test("a late defaults response cannot switch the kill switch back off (R29-5)", async ({
  page,
}) => {
  await page.goto("/settings");
  const kill = page.getByRole("switch", { name: "Kill switch" });
  await expect(kill).not.toBeChecked();
  // Refetches are slowed so what the save responses themselves wrote stays observable.
  await page.route("**/api/rpc/settings/get", async (route) => {
    await new Promise((r) => setTimeout(r, 3_000));
    await route.continue();
  });
  // The server processes the defaults save now (kill switch still off), but its response is held.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/rpc/settings/update", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.getByLabel("Max steps").fill("90");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await kill.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Stop All Runs" }).click();
  await expect(page.getByRole("group").filter({ hasText: "All runs stopped" })).toBeVisible();
  release();
  await expect(page.getByRole("group").filter({ hasText: "Defaults saved" })).toBeVisible();
  await expect(kill).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "Kill switch is on." })).toBeVisible();
  await expect(page.getByLabel("Max steps")).toHaveValue("90");
});

test("the kill switch keeps keyboard focus and its tab stop while a change is in flight (parked)", async ({
  page,
  baseURL,
}) => {
  // State-changing RPCs need a same-origin Origin header (the CSRF check from the backend merge).
  await page.request.post("/api/rpc/settings/setKillSwitch", {
    data: { json: { on: true } },
    headers: { origin: new URL(baseURL!).origin },
  });
  let calls = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/rpc/settings/setKillSwitch", async (route) => {
    calls += 1;
    await held;
    await route.continue();
  });
  await page.goto("/settings");
  const sw = page.getByRole("switch", { name: "Kill switch" });
  await sw.focus();
  await page.keyboard.press("Space");
  await expect(sw).toBeFocused();
  await expect(sw).toHaveAttribute("tabindex", "0");
  await expect(sw).toHaveAttribute("aria-disabled", "true");
  // It also looks unavailable while busy (I4).
  await expect(sw).toHaveCSS("opacity", "0.55");
  await page.keyboard.press("Space");
  expect(calls).toBe(1);
  release();
  await expect(sw).not.toBeChecked();
  await expect(sw).toBeFocused();
  await expect(sw).not.toHaveAttribute("aria-disabled", "true");
});

test("after confirming Stop all runs, focus is back on the busy switch", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/rpc/settings/setKillSwitch", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/settings");
  const sw = page.getByRole("switch", { name: "Kill switch" });
  await sw.focus();
  await page.keyboard.press("Space");
  await page.getByRole("alertdialog").getByRole("button", { name: "Stop All Runs" }).click();
  await expect(sw).toBeFocused();
  await expect(sw).toHaveAttribute("tabindex", "0");
  release();
  await expect(sw).toBeChecked();
  // The switch is optimistic: axe runs once the server's answer (its toast) is on screen.
  await expect(page.getByRole("group").filter({ hasText: "All runs stopped" })).toBeVisible();
  await expectCleanScreen(page);
});
