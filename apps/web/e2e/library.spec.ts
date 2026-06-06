import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("library lists notes as cards with icons and fidelity, clean at every width (Review Focus 3)", async ({
  page,
}) => {
  await page.goto("/library");
  const cards = page.locator('[data-qa="note-card"]');
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(10);
  await expect(page.getByText("Needs review").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Pneumonoultramicroscopic/ })).toBeVisible();
  await expectCleanScreen(page);
});

test("kind filter and view toggle are segmented radios kept in the URL", async ({ page }) => {
  await page.goto("/library");
  const kinds = page.getByRole("radiogroup", { name: "Filter by type" });
  await kinds.getByRole("radio", { name: "PDF" }).click();
  await expect(page).toHaveURL(/kind=pdf/);
  await expect(page.locator('[data-qa="note-card"]')).toHaveCount(1);
  await kinds.getByRole("radio", { name: "PDF" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/kind=youtube/);
  await page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "List" }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page.locator('[data-view="list"]')).toBeVisible();
  await expectCleanScreen(page);
});

test("a folder scope shows only its notes and an empty state when there are none", async ({
  page,
}) => {
  await page.goto("/library?folder=00000000-0000-4000-8000-000001000004");
  await expect(page.locator('[data-qa="note-card"]')).toHaveCount(1);
  await page.goto("/library?folder=00000000-0000-4000-8000-000001000006");
  // This folder has subfolder tiles, so the empty state speaks of notes only (I5). The full stop
  // is aria-hidden, so the accessible name has none.
  await expect(page.getByRole("heading", { name: "No notes in this folder yet" })).toBeVisible();
  await expectCleanScreen(page);
});

test("shows skeletons, not spinners, while loading", async ({ page }) => {
  await page.route("**/api/rpc/notes/list", async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  await page.goto("/library");
  const loading = page.getByRole("status", { name: "Loading notes" });
  await expect(loading).toBeVisible();
  await expect(loading.locator(".sk").first()).toBeVisible();
  await expect(page.locator('[data-qa="note-card"]').first()).toBeVisible();
});

test("cards are drawn as product shots with a fidelity badge in grid and list", async ({
  page,
}) => {
  await page.goto("/library");
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Learning-rate warmup" });
  await expect(card.locator(".card-art")).toBeVisible();
  await expect(card.getByText("Needs review")).toBeVisible();
  await page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "List" }).click();
  await expect(page.locator('[data-view="list"]')).toBeVisible();
  await expect(card.locator(".card-art")).toBeVisible();
});

test("a deleted note does not come back from the cache, by Back or by search (R29-6)", async ({
  page,
}) => {
  const title = "Cosine schedules in practice";
  await page.goto("/library");
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: title });
  await card.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  // Search for it too, so its hit is cached.
  await page.locator("html[data-hotkeys=ready]").waitFor({ state: "attached" });
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search notes" });
  await palette.getByRole("combobox").fill("safe default");
  await expect(palette.getByRole("option").filter({ hasText: title }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goBack();
  await card.getByRole("button", { name: new RegExp(`Actions for ${title}`) }).click();
  await page.getByRole("menuitem", { name: "Delete note…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete Note" }).click();
  await expect(card).toBeHidden();

  await page.goForward();
  await expect(page.getByRole("heading", { name: "This note isn't available" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeHidden();
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill("safe default");
  await expect(palette.getByRole("option").filter({ hasText: title })).toHaveCount(0);
});
