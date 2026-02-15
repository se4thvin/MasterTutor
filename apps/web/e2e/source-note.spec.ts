import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("Source | Note shows the captured text beside the note and stays in sync", async ({
  page,
}) => {
  await page.goto(NOTE);
  await page
    .getByRole("radiogroup", { name: "Layout" })
    .getByRole("radio", { name: "Source | Note" })
    .click();
  await expect(page).toHaveURL(/view=source/);
  const source = page.getByRole("region", { name: "Captured source" });
  await expect(source).toContainText("Go longer if you raise the batch size");
  await expectCleanScreen(page);
  await source.getByRole("button", { name: /The update rule/ }).click();
  await expect(page.locator(".blk-flash")).toContainText("The update rule");
});

test("View in source opens the split view on that block", async ({ page }) => {
  await page.goto(NOTE);
  await page.getByRole("button", { name: /Provenance for block 3:/ }).click();
  await page
    .getByRole("dialog", { name: "Block provenance" })
    .getByRole("button", { name: "View in source" })
    .click();
  await expect(page).toHaveURL(/view=source/);
  await expect(page.locator(".src-block-hot")).toBeVisible();
  await expectCleanScreen(page);
});

test("the source pane never renders markdown inside a button", async ({ page }) => {
  await page.goto(`${NOTE}?view=source`);
  const source = page.getByRole("region", { name: "Captured source" });
  await expect(source).toContainText("Go longer if you raise the batch size");
  expect(await source.locator("button p, button pre, button table, button a").count()).toBe(0);
});
