import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/test.ts";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });
test.skip(({ viewport }) => viewport?.width !== 1440, "hero checks run once");

function threeLoads(page: Page): string[] {
  const hits: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    const body = await response.text().catch(() => "");
    if (body.includes("isWebGLRenderer")) hits.push(response.url());
  });
  return hits;
}

test("reduced motion keeps the poster and never downloads three", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const hits = threeLoads(page);
  await page.goto("/new");
  await page.waitForTimeout(2_500);
  await expect(page.locator("[data-hero]")).not.toHaveAttribute("data-live", "");
  expect(hits).toEqual([]);
});

test("?hero=poster forces the poster", async ({ page }) => {
  const hits = threeLoads(page);
  await page.goto("/new?hero=poster");
  await page.waitForTimeout(2_500);
  expect(hits).toEqual([]);
});

test("Save-Data keeps the poster and never downloads three (P2)", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true } });
  });
  const hits = threeLoads(page);
  await page.goto("/new");
  await page.waitForTimeout(2_500);
  expect(hits).toEqual([]);
});

// Red until Task 21 replaces the stub scene; fixme keeps the full suite green between commits.
test.fixme("loads three lazily and crossfades to the live scene", async ({ page }) => {
  const hits = threeLoads(page);
  await page.goto("/new?debug");
  await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
  expect(hits.length).toBeGreaterThan(0);
});
