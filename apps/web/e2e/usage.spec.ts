import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("usage shows totals, an accessible daily chart and per-run spend", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  await expect(page.getByRole("heading", { level: 1, name: /Usage/ })).toBeVisible();
  await expect(page.getByText("Spend", { exact: true }).first()).toBeVisible();
  const chart = page.getByRole("figure", { name: "Daily spend" });
  const bars = chart.locator("[data-qa='bar']");
  await expect(bars).toHaveCount(30);
  const first = bars.first();
  const tip = page.locator(`[id="${await first.getAttribute("aria-describedby")}"]`);
  await expect(tip).toHaveRole("tooltip");
  await expect(tip).toBeHidden();
  await first.focus();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Sep 6");
  await page.getByText("Show data").click();
  await expect(page.getByRole("table", { name: "Daily spend data" })).toBeVisible();
  await expectCleanScreen(page);
  await page
    .getByRole("radiogroup", { name: "Range" })
    .getByRole("radio", { name: "7 days" })
    .click();
  await expect(bars).toHaveCount(7);
  await expect(page.getByRole("cell", { name: /Capture the learning-rate warmup/ })).toBeVisible();
});

test("90 days stays clean at every width", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  await page
    .getByRole("radiogroup", { name: "Range" })
    .getByRole("radio", { name: "90 days" })
    .click();
  await expect(
    page.getByRole("figure", { name: "Daily spend" }).locator("[data-qa='bar']"),
  ).toHaveCount(90);
  await expectCleanScreen(page);
});

test("the chart is one tab stop; arrow keys move between days", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  const bars = page.getByRole("figure", { name: "Daily spend" }).locator("[data-qa='bar']");
  await expect(bars).toHaveCount(30);
  await expect(bars.and(page.locator("[tabindex='0']"))).toHaveCount(1);
  // The stop is the latest day.
  await expect(bars.last()).toHaveAttribute("tabindex", "0");
  await bars.last().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(bars.nth(28)).toBeFocused();
  await expect(bars.nth(28)).toHaveAttribute("tabindex", "0");
  await expect(bars.and(page.locator("[tabindex='0']"))).toHaveCount(1);
  await page.keyboard.press("Home");
  await expect(bars.first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(bars.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(bars.last()).toBeFocused();
  // Tab leaves the chart in one step.
  await page.keyboard.press("Tab");
  await expect(bars.last()).not.toBeFocused();
  expect(await bars.evaluateAll((els) => els.some((el) => el === document.activeElement))).toBe(
    false,
  );
});

test("usage that fails to load offers Retry", async ({ page }) => {
  await page.route("**/api/rpc/settings/usage", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto("/settings/usage");
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn't load usage." }).getByRole("button", {
      name: "Retry",
    }),
  ).toBeVisible({ timeout: 10_000 });
});
