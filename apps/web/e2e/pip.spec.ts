import type { Page } from "@playwright/test";
import { rec } from "../lib/fixtures/run-recording.ts";
import { emit, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const mini = (page: Page) => page.getByRole("complementary", { name: "Mini browser" });

test("follows the watched run elsewhere, expands into the stream, and leaves when it finishes", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
  await gotoRun(page);
  await page.goto("/library");
  const expand = page.getByRole("button", {
    name: "Live run, learn.example.edu. Expand mini browser",
  });
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(page.getByRole("link", { name: "Open run" })).toBeVisible();
  await expect(mini(page).locator("iframe")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(expand).toBeVisible();
  await emit(page, [rec({ type: "status", status: "completed", waitReason: null, reason: null })]);
  await expect(mini(page)).toHaveCount(0);
});

test("never loads on a phone", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await gotoRun(page);
  await page.goto("/library");
  await expect(page.locator("h1")).toBeVisible();
  await expect(mini(page)).toHaveCount(0);
});
