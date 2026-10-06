import { failChunksContaining } from "./helpers/chunks.ts";
import type { Page } from "@playwright/test";
import { movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";
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

async function openMoveSheet(page: Page, title: RegExp) {
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: title });
  await card.getByRole("button", { name: new RegExp(`Actions for ${title.source}`) }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  return { card, sheet: page.getByRole("dialog", { name: "Move to…" }) };
}

test("the destination folder opens to receive the note, then the sheet closes", async ({
  page,
}) => {
  const { sheet } = await openMoveSheet(page, /Learning-rate warmup/);
  const papers = sheet.getByRole("button", { name: "Papers" });
  await papers.click();
  await expect(papers.locator(".fmark")).toHaveAttribute("data-lift", "");
  await expect(papers.locator(".move-pill")).toHaveText(/Learning-rate warmup/);
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("group").filter({ hasText: "Moved to Papers" })).toBeVisible();
});

test("a second pick during the receive animation is ignored (Review Focus 2)", async ({ page }) => {
  let moves = 0;
  await page.route("**/api/rpc/notes/move", async (route) => {
    moves += 1;
    await route.continue();
  });
  const { sheet } = await openMoveSheet(page, /Learning-rate warmup/);
  await sheet.getByRole("button", { name: "Papers" }).click();
  await expect(sheet.getByRole("button", { name: "Databases" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  // A disabled row does not light up under the pointer (m-8). Read it at once: a retrying
  // assertion would pass later, when the closing sheet drops pointer events.
  const databases = sheet.getByRole("button", { name: "Databases" });
  await databases.hover({ force: true });
  expect(
    await databases.evaluate((row) => [
      row.matches(":hover"),
      getComputedStyle(row).backgroundColor,
    ]),
  ).toEqual([true, "rgba(0, 0, 0, 0)"]);
  await sheet.getByRole("button", { name: "Databases" }).click({ force: true });
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("group").filter({ hasText: "Moved to Papers" })).toBeVisible();
  expect(moves).toBe(1);
  await expect(page.getByRole("group").filter({ hasText: "Moved to Databases" })).toHaveCount(0);
});

test("under reduced motion the sheet closes at once and nothing flies", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { sheet } = await openMoveSheet(page, /Learning-rate warmup/);
  await page.evaluate(() => {
    const seen = { pill: false };
    (window as { __pill?: typeof seen }).__pill = seen;
    new MutationObserver(() => {
      if (document.querySelector(".move-pill")) seen.pill = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  await sheet.getByRole("button", { name: "Papers" }).click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => (window as { __pill?: { pill: boolean } }).__pill?.pill)).toBe(
    false,
  );
  // The "Moved to" toast's countdown fuse is a timer, kept under reduced motion by design
  // (swipe-toast.tsx header); everything else must stay still.
  const moving = await movingAnimations(page, "body");
  expect(moving.filter((a) => a !== "script on toast-fuse")).toEqual([]);
});

test("moving a folder plays the same receive moment", async ({ page }) => {
  await page.goto(`/library?folder=00000000-0000-4000-8000-000001000004`);
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: /Move folder/ }).click();
  const sheet = page.getByRole("dialog", { name: "Move folder to…" });
  await expectCleanScreen(page);
  const target = sheet.getByRole("button", { name: "Databases" });
  await target.click();
  await expect(target.locator(".move-pill")).toHaveText("Papers");
  await expect(sheet).toBeHidden();
});

test("the pill flies in from beyond the glyph and nothing clips it (I2)", async ({ page }) => {
  const { sheet } = await openMoveSheet(page, /Learning-rate warmup/);
  const papers = sheet.getByRole("button", { name: "Papers" });
  await papers.click();
  await startSampling(page, "pill", ".move-pill", "translate", 12);
  const geometry = await papers.evaluate((row) => {
    const pill = row.querySelector(".move-pill");
    const mark = row.querySelector(".fmark");
    if (!pill || !mark) return null;
    const clippers: string[] = [];
    for (let el = pill.parentElement; el && el !== row; el = el.parentElement) {
      if (getComputedStyle(el).overflow !== "visible") clippers.push(el.className);
    }
    return {
      pillRight: pill.getBoundingClientRect().right,
      markRight: mark.getBoundingClientRect().right,
      clippers,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.clippers, "no ancestor inside the row may clip the pill").toEqual([]);
  expect(geometry!.pillRight).toBeGreaterThan(geometry!.markRight);
  const samples = await readSamples(page, "pill", 12);
  // It starts about 2.5rem to the right and travels into the glyph.
  const offsets = samples.filter(Boolean).map((v) => parseFloat(v));
  expect(Math.max(...offsets), samples.join(" | ")).toBeGreaterThan(16);
  await expect(sheet).toBeHidden();
});

test("if the move sheet can't load, Move to… says so and works on the next try", async ({
  page,
}) => {
  let offline = true;
  await failChunksContaining(page, "move-pill", () => offline);
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: /Learning-rate warmup/ });
  const openSheet = async () => {
    await card.getByRole("button", { name: /Actions for Learning-rate warmup/ }).click();
    await page.getByRole("menuitem", { name: "Move to…" }).click();
  };
  await openSheet();
  await expect(page.getByRole("group").filter({ hasText: "Couldn't open Move to…" })).toBeVisible();
  await expect(card).toBeVisible();
  offline = false;
  // The retry is a reload: the bundler keeps a failed chunk for the page's lifetime.
  await page
    .getByRole("group")
    .filter({ hasText: "Couldn't open Move to…" })
    .getByRole("button", { name: "Reload" })
    .click();
  await openSheet();
  await expect(page.getByRole("dialog", { name: "Move to…" })).toBeVisible();
});
