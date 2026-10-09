import type { Page } from "@playwright/test";
import { ids } from "../lib/fixtures/ids.ts";
import { gotoReady } from "./helpers/folders.ts";
import { gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

/**
 * Liquid Glass across the app (LiquidGlass): the floating and navigation layer is glass, content
 * stays solid, glass never sits on glass, and few backdrop layers are live at once (each is a
 * backdrop pass per frame). Reduced transparency makes every glass surface solid.
 */

/** Visible elements with a live backdrop-filter, by their classes other than the material's. */
async function glassLayers(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.backdropFilter !== "none" && s.visibility !== "hidden" && r.width > 0;
      })
      .map((el) =>
        typeof el.className === "string"
          ? el.className.replace(/\b(glass|lglass)\b/g, "").trim() || "glass"
          : el.tagName,
      ),
  );
}

const SCREENS = [
  "/library",
  "/new",
  "/runs",
  `/notes/${ids.note(1)}`,
  "/vault",
  "/settings",
] as const;

test("at rest a screen has one blurred layer at most: its toolbar (the docked sidebar does not blur)", async ({
  page,
}) => {
  for (const path of SCREENS) {
    await gotoReady(page, path);
    const layers = await glassLayers(page);
    expect(layers.length, `${path}: ${layers.join(", ")}`).toBeLessThanOrEqual(1);
    await expect(page.locator(".sidebar")).toHaveClass(/lglass/);
  }
});

test("the run view, with the live browser under its overlays, keeps the same one", async ({
  page,
}) => {
  await gotoRun(page);
  const layers = await glassLayers(page);
  expect(layers.length, layers.join(", ")).toBeLessThanOrEqual(1);
});

test("while a modal glass panel is up it is the only blur: the chrome beneath stops blurring", async ({
  page,
}) => {
  await gotoReady(page, "/library");
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await expect(page.locator(".sheet")).toBeVisible();
  const layers = await glassLayers(page);
  expect(layers.length, layers.join(", ")).toBe(1);
  expect(layers[0]).toMatch(/^sheet/);
});

test("menus, sheets, the palette and dialogs are Liquid Glass; a menu adds one layer", async ({
  page,
}) => {
  await gotoReady(page, "/library");
  const before = (await glassLayers(page)).length;
  await page.getByRole("button", { name: "Folder actions" }).click();
  await expect(page.getByRole("menu")).toHaveClass(/lglass/);
  expect((await glassLayers(page)).length).toBe(before + 1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".palette")).toHaveClass(/lglass/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await expect(page.locator(".sheet")).toHaveClass(/lglass/);
});

test("never glass on glass: popups over an open glass sheet, and glass inside glass, are solid", async ({
  page,
}) => {
  await gotoReady(page, "/library");
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await expect(page.locator(".sheet")).toBeVisible();
  const solid = await page.evaluate(() => {
    // A popup shown over the sheet, and a glass element nested in the sheet's glass.
    const menu = Object.assign(document.createElement("div"), { className: "menu glass lglass" });
    const nested = Object.assign(document.createElement("div"), { className: "glass lglass" });
    document.body.append(menu);
    document.querySelector(".sheet")!.append(nested);
    const read = (el: Element) => getComputedStyle(el).backdropFilter;
    const result = [read(menu), read(nested), read(document.querySelector(".sheet")!)];
    menu.remove();
    nested.remove();
    return result;
  });
  expect(solid.slice(0, 2)).toEqual(["none", "none"]);
  expect(solid[2]).not.toBe("none");
});

test("reduced transparency makes glass solid", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });
  await gotoReady(page, "/library");
  expect(await glassLayers(page)).toEqual([]);
  const alpha = await page
    .locator(".sidebar")
    .evaluate((el) => getComputedStyle(el).backgroundColor.match(/[\d.]+/g)!.length === 3);
  expect(alpha, "an opaque rgb() background").toBe(true);
});
