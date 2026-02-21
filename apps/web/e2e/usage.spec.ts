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
  await expect(page.getByRole("link", { name: /Capture the learning-rate warmup/ })).toBeVisible();
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
