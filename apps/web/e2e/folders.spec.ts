import type { Locator, Page } from "@playwright/test";
import { movingAnimations } from "./helpers/motion.ts";
import { expect, expectCleanScreen, isWide, test } from "./helpers/test.ts";

async function openTree(page: Page) {
  if (!isWide(page)) await page.getByRole("button", { name: "Folders" }).click();
  return page.getByRole("tree", { name: "Folders" });
}

test("tree shows nested folders, navigates, and supports arrow keys", async ({ page }) => {
  await page.goto("/library");
  const tree = await openTree(page);
  await tree.getByRole("treeitem", { name: "Machine learning" }).click();
  await expect(page).toHaveURL(/folder=00000000-0000-4000-8000-000001000001/);
  const tree2 = await openTree(page);
  const ml = tree2.getByRole("treeitem", { name: "Machine learning" });
  await ml.focus();
  await page.keyboard.press("ArrowRight");
  await expect(ml).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(tree2.getByRole("treeitem", { name: "Optimization" })).toBeFocused();
  await expectCleanScreen(page);
});

test("creates, renames and deletes a folder with a safe default", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Reading list");
  await page.getByRole("button", { name: "Create" }).click();
  const tree = await openTree(page);
  await expect(tree.getByRole("treeitem", { name: "Reading list" })).toBeVisible();
  await tree.getByRole("treeitem", { name: "Reading list" }).click();

  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Folder name").fill("Reading");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Reading");

  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "Delete folder…" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
  await alert.getByRole("button", { name: "Delete Folder" }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test("refuses a duplicate name with a field error", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("databases");
  await page.getByRole("button", { name: "Create" }).click();
  // Next's route announcer is also role=alert, so scope to the field error.
  await expect(page.locator("p[role=alert]")).toHaveText(
    "A folder with that name already exists here.",
  );
});

test("a folder cannot be dropped into its own subfolder; a legal drop moves it (Review Focus 4)", async ({
  page,
}) => {
  test.skip(!isWide(page), "drag targets live in the wide sidebar");
  const moves: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/rpc/folders/move")) moves.push(request.url());
  });
  await page.goto("/library");
  const tree = page.getByRole("tree", { name: "Folders" });
  const item = (name: string) => tree.getByRole("treeitem", { name });
  await item("Machine learning").focus();
  await page.keyboard.press("ArrowRight");
  await expect(item("Optimization")).toBeVisible();

  // Cycle: Machine learning is the parent of Optimization. Nothing may be sent or change.
  await item("Machine learning").dragTo(item("Optimization"));
  await expect(item("Machine learning")).toHaveAttribute("aria-level", "1");
  await expect(item("Optimization")).toHaveAttribute("aria-level", "2");
  await expect(item("Papers")).toHaveAttribute("aria-level", "2");
  expect(moves, "a cycle move must not reach the server").toEqual([]);

  // Legal: Papers (level 2, inside Machine learning) goes to the root through "All notes".
  const moved = page.waitForRequest((r) => r.url().includes("/api/rpc/folders/move"));
  await item("Papers").dragTo(item("All notes"));
  await moved;
  await expect(item("Papers")).toHaveAttribute("aria-level", "1");
  await expect(item("Machine learning")).toHaveAttribute("aria-level", "1");
  expect(moves).toHaveLength(1);
});

test("tree items report their set size and position", async ({ page }) => {
  await page.goto("/library");
  const tree = await openTree(page);
  // Top level: All notes, Unfiled, Machine learning, Databases, Coursework.
  const ml = tree.getByRole("treeitem", { name: "Machine learning" });
  await expect(ml).toHaveAttribute("aria-setsize", "5");
  await expect(ml).toHaveAttribute("aria-posinset", "3");
  await expect(tree.getByRole("treeitem", { name: "Coursework" })).toHaveAttribute(
    "aria-posinset",
    "5",
  );
  await ml.focus();
  await page.keyboard.press("ArrowRight");
  await expect(tree.getByRole("treeitem", { name: "Papers" })).toHaveAttribute("aria-setsize", "2");
  await expect(tree.getByRole("treeitem", { name: "Papers" })).toHaveAttribute(
    "aria-posinset",
    "2",
  );
});

test("Move folder to… is a keyboard path that offers only legal destinations", async ({ page }) => {
  const moves: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/rpc/folders/move")) moves.push(r.url());
  });
  // Machine learning: its own subfolders are not destinations (a cycle).
  await page.goto("/library?folder=00000000-0000-4000-8000-000001000001");
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "Move folder to…" }).click();
  const ml = page.getByRole("dialog", { name: "Move folder to…" });
  await expect(ml.getByRole("button", { name: "Databases" })).toBeVisible();
  await expect(ml.getByRole("button", { name: "Optimization" })).toHaveCount(0);
  await expect(ml.getByRole("button", { name: "Machine learning" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Papers lives in Machine learning; move it under Databases.
  await page.goto("/library?folder=00000000-0000-4000-8000-000001000004");
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "Move folder to…" }).click();
  const sheet = page.getByRole("dialog", { name: "Move folder to…" });
  await expectCleanScreen(page);
  await sheet.getByRole("button", { name: "Databases" }).click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Databases");
  expect(moves).toHaveLength(1);
});

test("dropping a folder on its current parent sends nothing", async ({ page }) => {
  test.skip(!isWide(page), "drag targets live in the wide sidebar");
  const moves: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/rpc/folders/move")) moves.push(r.url());
  });
  await page.goto("/library");
  const tree = page.getByRole("tree", { name: "Folders" });
  await tree.getByRole("treeitem", { name: "Machine learning" }).focus();
  await page.keyboard.press("ArrowRight");
  // Machine learning is a root: dropping it on "All notes" is its current parent (the root).
  await tree
    .getByRole("treeitem", { name: "Machine learning" })
    .dragTo(tree.getByRole("treeitem", { name: "All notes" }));
  await expect(tree.getByRole("treeitem", { name: "Machine learning" })).toHaveAttribute(
    "aria-level",
    "1",
  );
  expect(moves).toEqual([]);
});

/**
 * Moves an HTML5 drag (already started with mouse.down) to the middle of `target`. Playwright fires
 * dragover only on a mouse move inside the target, not continuously like a browser, so the last
 * one-pixel move is what lets the row accept the drop.
 */
async function dragInto(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
}

test.describe("folder rows float and lift their lid (D43 FolderFloat)", () => {
  test("hovering a folder row floats its glyph", async ({ page }) => {
    test.skip(!isWide(page), "the sidebar tree is hoverable only on wide layouts");
    await page.goto("/library");
    const row = page
      .getByRole("tree", { name: "Folders" })
      .getByRole("treeitem", { name: "Databases" });
    await row.hover();
    await expect(row.locator(".fmark")).toHaveCSS("rotate", "-8deg");
  });

  test("dragging a note over a folder row lifts the lid until the drag leaves", async ({
    page,
  }) => {
    test.skip(!isWide(page), "drag targets in the sidebar tree are wide-only");
    await page.goto("/library?folder=00000000-0000-4000-8000-000001000002");
    const card = page.locator('[data-qa="note-card"]').first();
    const row = page
      .getByRole("tree", { name: "Folders" })
      .getByRole("treeitem", { name: "Databases" });
    const mark = row.locator(".fmark");
    await card.hover();
    await page.mouse.down();
    await dragInto(page, row);
    await expect(mark).toHaveAttribute("data-lift", "");
    await expect(mark.locator(".fmark-open")).toHaveCSS("opacity", "1");
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 4, { steps: 4 });
    await expect(mark).not.toHaveAttribute("data-lift", "");
    await page.mouse.up();
  });

  test("under reduced motion the lid still lifts but nothing moves", async ({ page }) => {
    test.skip(!isWide(page), "drag targets in the sidebar tree are wide-only");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/library?folder=00000000-0000-4000-8000-000001000002");
    const row = page
      .getByRole("tree", { name: "Folders" })
      .getByRole("treeitem", { name: "Databases" });
    await row.hover();
    await expect(row.locator(".fmark")).toHaveCSS("rotate", "none");
    await page.locator('[data-qa="note-card"]').first().hover();
    await page.mouse.down();
    await dragInto(page, row);
    await expect(row.locator(".fmark")).toHaveAttribute("data-lift", "");
    await expect(row.locator(".fmark")).toHaveCSS("translate", "none");
    expect(await movingAnimations(page, ".tree")).toEqual([]);
    await page.mouse.up();
  });

  test("the tree stays clean with folder marks at every width", async ({ page }) => {
    await page.goto("/library");
    await openTree(page);
    await expectCleanScreen(page);
  });
  test("a lid-less row (Unfiled) keeps its glyph while a note drags over it (I1)", async ({
    page,
  }) => {
    test.skip(!isWide(page), "drag targets in the sidebar tree are wide-only");
    await page.goto("/library?folder=00000000-0000-4000-8000-000001000002");
    const row = page
      .getByRole("tree", { name: "Folders" })
      .getByRole("treeitem", { name: "Unfiled" });
    const mark = row.locator(".fmark");
    await page.locator('[data-qa="note-card"]').first().hover();
    await page.mouse.down();
    await dragInto(page, row);
    await expect(mark).toHaveAttribute("data-lift", "");
    await expect(mark.locator(".fmark-open")).toHaveCount(0);
    await expect(mark.locator(".fmark-shut")).toHaveCSS("opacity", "1");
    await page.mouse.up();
  });
});
