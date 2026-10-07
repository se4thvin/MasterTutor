import type { Page } from "@playwright/test";
import { OTHER_RUN_ID, rec } from "../lib/fixtures/run-recording.ts";
import { emit, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const mini = (page: Page) => page.getByRole("region", { name: "Mini browser" });

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

test("keeps keyboard focus through expand and shrink; Escape only acts inside it (I2)", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
  await gotoRun(page);
  await page.goto("/library");
  const expand = page.getByRole("button", {
    name: "Live run, learn.example.edu. Expand mini browser",
  });
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Open run" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(expand).toBeFocused();
  // An Escape meant for something else (here, the page) never shrinks it.
  await expand.click();
  await page.locator("h1").first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Open run" })).toBeVisible();
});

test("speaks its caption once, and is a region beside the page, not inside main (M1, M2)", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
  await gotoRun(page);
  await page.goto("/library");
  await page
    .getByRole("button", { name: "Live run, learn.example.edu. Expand mini browser" })
    .click();
  await expect(page.getByRole("link", { name: "Open run" })).toBeVisible();
  // The under-caption is hidden while the bar shows the same words.
  await expect(mini(page).locator(".run-pip-caption")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("main aside")).toHaveCount(0);
});

test("is never on any run's page, even another run's (M3)", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
  await gotoRun(page);
  await page.goto("/library");
  await expect(mini(page)).toHaveCount(1);
  await page.goto(`/runs/${OTHER_RUN_ID}`);
  await expect(page.locator("h1")).toBeVisible();
  await expect(mini(page)).toHaveCount(0);
});

test("an Escape someone else already handled leaves it big (final M12)", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
  await gotoRun(page);
  await page.goto("/library");
  await page
    .getByRole("button", { name: "Live run, learn.example.edu. Expand mini browser" })
    .click();
  const open = page.getByRole("link", { name: "Open run" });
  await expect(open).toBeFocused();
  await open.evaluate((link) =>
    link.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") event.preventDefault();
    }),
  );
  await page.keyboard.press("Escape");
  await expect(open).toBeVisible();
});
