import type { Page } from "@playwright/test";
import { moved, movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("library search shows block hits with highlights and a recovery path", async ({ page }) => {
  await page.goto("/library");
  const field = page.getByRole("searchbox", { name: "Search the library" });
  await field.fill("grad_norm");
  const results = page.getByRole("list", { name: "Search results" });
  await expect(results.getByRole("link", { name: /Learning-rate warmup/ })).toBeVisible();
  await expect(results.locator("mark").first()).toHaveText(/grad_norm/i);
  await expect(page).toHaveURL(/q=grad_norm/);
  await expectCleanScreen(page);
  await field.fill("zzzz-nothing");
  // The full stop is aria-hidden, so the accessible name has none.
  await expect(page.getByRole("heading", { name: "No results" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator('[data-qa="note-card"]').first()).toBeVisible();
});

test("⌘K opens the palette from anywhere and Enter opens the block", async ({ page }) => {
  await page.goto("/settings");
  // The shortcut is attached in an effect; pressing before hydration would silently do nothing.
  await page.locator("html[data-hotkeys=ready]").waitFor({ state: "attached" });
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search notes" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("NaN");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  await expectCleanScreen(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]+#block-/);
});

test("the palette says when nothing matches and closes with Escape", async ({ page }) => {
  await page.goto("/library");
  await page.locator("html[data-hotkeys=ready]").waitFor({ state: "attached" });
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search notes" });
  await dialog.getByRole("combobox").fill("zzzz-nothing");
  await expect(dialog.getByText("No notes match “zzzz-nothing”.")).toBeVisible();
  await expectCleanScreen(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("snippets render page text as text, never HTML", async ({ page }) => {
  await page.goto("/library?q=%3Ctable");
  await expect(page.getByRole("list", { name: "Search results" })).toContainText("<table");
});

test("the search field follows the URL after a folder click and back/forward", async ({ page }) => {
  await page.goto("/library");
  const field = page.getByRole("searchbox", { name: "Search the library" });
  await field.pressSequentially("warmup");
  await expect(page).toHaveURL(/q=warmup/);
  await expect(page.getByRole("list", { name: "Search results" })).toBeVisible();

  const wide = (page.viewportSize()?.width ?? 0) > 1180;
  if (!wide) await page.getByRole("button", { name: "Folders" }).click();
  await page
    .getByRole("tree", { name: "Folders" })
    .getByRole("treeitem", { name: "Databases" })
    .click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(field).toHaveValue("");
  await expect(page.getByRole("list", { name: "Search results" })).toBeHidden();
  await expect(page.locator('[data-qa="note-card"]').first()).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/q=warmup/);
  await expect(field).toHaveValue("warmup");
  await expect(page.getByRole("list", { name: "Search results" })).toBeVisible();
  await page.goForward();
  await expect(field).toHaveValue("");
});

async function openPaletteWith(page: Page, query: string) {
  await page.goto("/library");
  await page.locator("html[data-hotkeys=ready]").waitFor({ state: "attached" });
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search notes" });
  await dialog.getByRole("combobox").fill(query);
  await expect(dialog.getByRole("option").nth(1)).toBeVisible();
  await page.locator("html[data-layout-motion=ready]").waitFor({ state: "attached" });
  return dialog;
}

test("the selection highlight glides between results", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
  const dialog = await openPaletteWith(page, "warmup");
  await page.keyboard.press("ArrowDown");
  await expect(dialog.locator(".hit-highlight")).toHaveCount(1);
  await startSampling(page, "glide", ".hit-highlight", "transform", 30);
  await page.keyboard.press("ArrowDown");
  const samples = await readSamples(page, "glide", 30);
  expect(samples.some(moved), samples.join(" | ")).toBe(true);
  await expect(dialog.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
});

test("under reduced motion the highlight jumps and results do not slide", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dialog = await openPaletteWith(page, "warmup");
  expect(await movingAnimations(page, ".palette-list")).toEqual([]);
  await page.keyboard.press("ArrowDown");
  await startSampling(page, "jump", ".hit-highlight", "transform", 20);
  await page.keyboard.press("ArrowDown");
  const samples = await readSamples(page, "jump", 20);
  expect(samples.filter(moved), samples.join(" | ")).toEqual([]);
  await expect(dialog.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
});

test("the palette with results stays clean at every width", async ({ page }) => {
  await openPaletteWith(page, "warmup");
  await page.keyboard.press("ArrowDown");
  await expectCleanScreen(page);
});
