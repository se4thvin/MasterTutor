import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/test.ts";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

function threeLoads(page: Page): string[] {
  const hits: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    const body = await response.text().catch(() => "");
    if (body.includes("isWebGLRenderer")) hits.push(response.url());
  });
  return hits;
}

test.describe("at 1440 (hero checks run once)", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "hero checks run once");

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

  test("loads three lazily and crossfades to the live scene", async ({ page }) => {
    const hits = threeLoads(page);
    await page.goto("/new?debug");
    await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
    expect(hits.length).toBeGreaterThan(0);
  });

  test("hero:start plays the capture and emits hero:captured", async ({ page }) => {
    await page.goto("/new?debug");
    await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
    const captured = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          window.addEventListener("hero:captured", () => resolve(true), { once: true });
          window.dispatchEvent(new CustomEvent("hero:start"));
          setTimeout(() => resolve(false), 6_000);
        }),
    );
    expect(captured).toBe(true);
  });

  test("Start waits for the capture before opening the run", async ({ page }) => {
    await page.goto("/new");
    await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
    await page.getByLabel("Describe the task").fill("Capture example.com");
    await page.getByRole("button", { name: "Add domain" }).click();
    await page.getByRole("textbox", { name: "Allowed domain" }).fill("example.com");
    await page.getByRole("textbox", { name: "Allowed domain" }).press("Enter");
    const t0 = Date.now();
    await page.getByRole("button", { name: /^Start/ }).click();
    await page.waitForURL(/\/runs\//);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1_100);
  });
});

test("pauses rendering offscreen", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await page.goto("/new?debug");
  await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
  // The shell scrolls #main, not the window.
  await page.locator("#main").evaluate((main) => main.scrollTo({ top: main.scrollHeight }));
  await page.waitForTimeout(500);
  const a = await page.evaluate(
    () => (window as unknown as { __heroStats: { frames: number } }).__heroStats.frames,
  );
  await page.waitForTimeout(800);
  const b = await page.evaluate(
    () => (window as unknown as { __heroStats: { frames: number } }).__heroStats.frames,
  );
  expect(b - a).toBeLessThanOrEqual(2);
});
