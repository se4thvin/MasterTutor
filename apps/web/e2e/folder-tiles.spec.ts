import type { Page } from "@playwright/test";
import { ids } from "../lib/fixtures/ids.ts";
import { movingAnimations } from "./helpers/motion.ts";
import { expect, expectCleanScreen, isCompact, test } from "./helpers/test.ts";

const ML = `/library?folder=${ids.folder(1)}`;
const tiles = (page: Page) =>
  page.getByRole("region", { name: "Folders" }).locator('[data-qa="folder-tile"]');

test("a folder's subfolders show as tiles that open the folder", async ({ page }) => {
  await page.goto(ML);
  await expect(tiles(page)).toHaveText([/Optimization/, /Papers/]);
  await expect(tiles(page).first()).toContainText("1 folder");
  // The name reads as a phrase, not "Optimization1 folder".
  await expect(tiles(page).first()).toHaveAccessibleName("Optimization, 1 folder");
  await expectCleanScreen(page);
  await tiles(page).filter({ hasText: "Papers" }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${ids.folder(4)}`));
  await expect(page.getByRole("region", { name: "Folders" })).toHaveCount(0);
});

test("keyboard focus opens the folder visually and Enter navigates", async ({ page }) => {
  await page.goto(ML);
  const tile = tiles(page).filter({ hasText: "Optimization" });
  await tile.focus();
  await expect(tile.locator(".ff-paper").first()).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`folder=${ids.folder(2)}`));
});

async function dragCardOver(page: Page, cardTitle: string, tileName: string) {
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: cardTitle });
  const tile = tiles(page).filter({ hasText: tileName });
  await card.hover();
  await page.mouse.down();
  // Start the drag on the card first: the card sits below the tiles, and scrolling the tile into
  // view before dragstart would leave the pointer over nothing draggable.
  const from = (await card.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 2 });
  await tile.hover();
  // Playwright fires dragover only on a move inside the target (a browser repeats it); nudge once.
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
  return tile;
}

test("dropping a note on a tile moves it and the folder takes it in", async ({ page }) => {
  test.skip(isCompact(page), "card and tile drags are checked on regular widths");
  await page.goto("/library");
  const tile = await dragCardOver(page, "Unfiled clipping", "Databases");
  await expect(tile.locator(".ff")).toHaveAttribute("data-open", "");
  // A static drop cue (inset ring), so drag-over differs from hover even without motion.
  await expect(tile.locator(".ff-front")).toHaveCSS("box-shadow", /inset/);
  await page.mouse.up();
  await expect(tile.locator(".ff")).toHaveAttribute("data-receive", "");
  await expect(page.getByRole("group").filter({ hasText: "Moved to Databases" })).toBeVisible();
});

test("the lid stays up while the drag crosses the tile's label (Review Focus 1)", async ({
  page,
}) => {
  test.skip(isCompact(page), "card and tile drags are checked on regular widths");
  await page.goto("/library");
  const tile = await dragCardOver(page, "Unfiled clipping", "Databases");
  const label = (await tile.locator(".ff-label").boundingBox())!;
  for (const dx of [0.1, 0.5, 0.9]) {
    await page.mouse.move(label.x + label.width * dx, label.y + label.height / 2, { steps: 3 });
    await expect(tile.locator(".ff")).toHaveAttribute("data-open", "");
  }
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y - 200, { steps: 4 });
  await expect(tile.locator(".ff")).not.toHaveAttribute("data-open", "");
  await page.mouse.up();
});

test("under reduced motion the flap never tilts; the paper only fades", async ({ page }) => {
  test.skip(isCompact(page), "hover is checked on regular widths");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(ML);
  const tile = tiles(page).filter({ hasText: "Optimization" });
  const front = tile.locator(".ff-front");
  const rest = await front.evaluate((el) => getComputedStyle(el).transform);
  const paper = tile.locator(".ff-paper").first();
  // The paper never sits offset, so hovering out cannot make it jump while it fades.
  await expect(paper).toHaveCSS("translate", "none");
  await tile.hover();
  await expect(paper).toHaveCSS("opacity", "1");
  await expect(paper).toHaveCSS("translate", "none");
  expect(await front.evaluate((el) => getComputedStyle(el).transform)).toBe(rest);
  expect(await movingAnimations(page, ".ftiles")).toEqual([]);
});

test("a 120-character folder name stays inside its tile (Review Focus 4)", async ({
  page,
  baseURL,
}) => {
  const name = `Lecture recordings, annotated slides and problem sets ${"x".repeat(66)}`.slice(
    0,
    120,
  );
  await page.goto("/library");
  const created = await page.request.post("/api/rpc/folders/create", {
    data: { json: { name, parentId: null } },
    headers: { origin: new URL(baseURL!).origin },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/library");
  const tile = tiles(page).filter({ hasText: name.slice(0, 20) });
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAccessibleName(new RegExp(name.slice(0, 20)));
  await expect(tile.locator(".ff-label")).toHaveCSS("text-overflow", "ellipsis");
  await expectCleanScreen(page);
});
