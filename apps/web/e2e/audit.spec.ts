import { expect, expectCleanScreen, isCompact, test } from "./helpers/test.ts";

test("audit log lists vault events with paging, clean at every width", async ({ page }) => {
  await page.goto("/settings/audit");
  await expect(page.getByRole("heading", { level: 1, name: /Audit log/ })).toBeVisible();
  const entries = page.locator("[data-qa='audit-entry']");
  await expect(entries).toHaveCount(50);
  await expect(page.getByText("Denied").first()).toBeVisible();
  if (!isCompact(page))
    await expect(page.getByRole("table", { name: "Vault audit" })).toBeVisible();
  else await expect(page.getByRole("list", { name: "Vault audit" })).toBeVisible();
  await expectCleanScreen(page);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(entries).toHaveCount(60);
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden();
});

test("audit entries are newest first and a refusal carries a word, not only a colour", async ({
  page,
}) => {
  await page.goto("/settings/audit");
  const entries = page.locator("[data-qa='audit-entry']");
  await expect(entries).toHaveCount(50);
  const denied = entries.filter({ hasText: "Denied" }).first();
  await expect(denied).toContainText("origin mismatch");
  await expect(denied.locator(".badge-warn svg")).toBeVisible();
  const times = await entries
    .locator("time")
    .evaluateAll((els) => els.map((el) => el.getAttribute("datetime") ?? ""));
  expect(times.length).toBe(50);
  expect([...times].sort().reverse()).toEqual(times);
});
