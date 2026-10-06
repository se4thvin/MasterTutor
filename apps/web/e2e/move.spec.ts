import { expect, expectCleanScreen, isWide, test } from "./helpers/test.ts";

const OPT = "/library?folder=00000000-0000-4000-8000-000001000002";

test("Move to… moves optimistically and Undo restores it", async ({ page }) => {
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Learning-rate warmup" });
  await card.getByRole("button", { name: /Actions for Learning-rate/ }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const sheet = page.getByRole("dialog", { name: "Move to…" });
  await expectCleanScreen(page);
  await sheet.getByRole("button", { name: "Papers" }).click();
  await expect(card).toBeHidden();
  // The toast is a role=group inside the persistent aria-live region.
  const toast = page.getByRole("group").filter({ hasText: "Moved to Papers" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(card).toBeVisible();
});

test("a failed move rolls back and says so (Review Focus 5)", async ({ page }) => {
  await page.route("**/api/rpc/notes/move", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Learning-rate warmup" });
  await card.getByRole("button", { name: /Actions for Learning-rate/ }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page
    .getByRole("dialog", { name: "Move to…" })
    .getByRole("button", { name: "Unfiled" })
    .click();
  await expect(
    page.getByRole("group").filter({ hasText: "Couldn't move the note." }),
  ).toBeVisible();
  await expect(card).toBeVisible();
});

test("Undo still works after navigating away", async ({ page }) => {
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Why warmup works" });
  await card.getByRole("button", { name: /Actions for Why warmup/ }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page
    .getByRole("dialog", { name: "Move to…" })
    .getByRole("button", { name: "Unfiled" })
    .click();
  // /runs exists today; /vault arrives with F4 and would only prove the same thing.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Runs" })
    .click();
  await expect(page).toHaveURL(/\/runs$/);
  await page
    .getByRole("group")
    .filter({ hasText: "Moved to Unfiled" })
    .getByRole("button", { name: "Undo" })
    .click();
  await page.goto(OPT);
  await expect(
    page.locator('[data-qa="note-card"]').filter({ hasText: "Why warmup works" }),
  ).toBeVisible();
});

test("dragging a card onto a sidebar folder moves it", async ({ page }) => {
  test.skip(!isWide(page), "sidebar tree is wide-only; compact uses Move to…");
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Learning-rate warmup" });
  await card.dragTo(
    page.getByRole("tree", { name: "Folders" }).getByRole("treeitem", { name: "Databases" }),
  );
  await expect(page.getByRole("group").filter({ hasText: "Moved to Databases" })).toBeVisible();
  await expect(card).toBeHidden();
});

test("deleting a note asks first and keeps Cancel as the default", async ({ page }) => {
  await page.goto("/library?folder=unfiled");
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Unfiled clipping" });
  await card.getByRole("button", { name: /Actions for Unfiled clipping/ }).click();
  await page.getByRole("menuitem", { name: "Delete note…" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
  await alert.getByRole("button", { name: "Delete Note" }).click();
  await expect(card).toBeHidden();
});
