import type { Locator, Page } from "@playwright/test";
import {
  LONG_CHILD,
  LONG_FOLDER,
  LONG_UNBROKEN,
  createFolder,
  gotoReady,
  openFolderTree,
} from "./helpers/folders.ts";
import { settle } from "./helpers/clean-screen.ts";
import { findLayoutIssues } from "./helpers/layout-qa.ts";
import { movingAnimations } from "./helpers/motion.ts";
import { expect, expectCleanScreen, isWide, test } from "./helpers/test.ts";

/**
 * The sidebar's folder outline with names longer than any row, at every QA width (the sidebar's
 * tree on wide screens, the Folders sheet below lg): rows keep their box, names are cut with a
 * fade and glide into view on hover or keyboard focus, and reduced motion swaps the glide for a
 * tooltip. The full name is always the row's title and accessible name.
 */

const ML = "00000000-0000-4000-8000-000001000001";

async function seedLongFolders(page: Page) {
  await gotoReady(page, "/library");
  await createFolder(page, LONG_FOLDER);
  await createFolder(page, LONG_UNBROKEN);
  await gotoReady(page, `/library?folder=${ML}`);
  await createFolder(page, LONG_CHILD, true);
}

const row = (tree: Locator, name: string) => tree.getByRole("treeitem", { name, exact: true });

/** The folder tree with Machine learning open, so its long child is on screen. */
async function openTree(page: Page) {
  const tree = await openFolderTree(page);
  // Folders loaded (the current folder's ancestors open in the same render) and the sheet risen.
  await row(tree, LONG_UNBROKEN).waitFor();
  await settle(page);
  if (!(await row(tree, LONG_CHILD).isVisible()))
    await row(tree, "Machine learning").locator(".tree-disclosure").click();
  await row(tree, LONG_CHILD).waitFor();
  await settle(page);
  return tree;
}

/** The glide on a row's text, if one runs: its timing and its far keyframe's shift. */
async function glideOf(item: Locator) {
  return item.locator(".marquee-text").evaluate((el) => {
    const [animation] = el.getAnimations();
    if (!animation) return null;
    const effect = animation.effect as KeyframeEffect;
    const far = effect.getKeyframes().map((k) => String(k["transform"]));
    return { duration: Number(effect.getComputedTiming().duration), far: far[2] ?? "" };
  });
}

/** Seeks the row's glide to a fraction of its run (the far rest is 0.5) and measures the text. */
async function seek(item: Locator, fraction: number) {
  return item.locator(".marquee").evaluate((box, f) => {
    const text = box.querySelector(".marquee-text")!;
    const [animation] = text.getAnimations();
    animation!.pause();
    animation!.currentTime = Number(animation!.effect!.getComputedTiming().duration) * f;
    const b = box.getBoundingClientRect();
    const t = text.getBoundingClientRect();
    return { boxLeft: b.left, boxRight: b.right, textLeft: t.left, textRight: t.right };
  }, fraction);
}

test.beforeEach(async ({ page }) => {
  await seedLongFolders(page);
});

test("long names stay inside their rows, cut with a fade, with the full name in title and label", async ({
  page,
}) => {
  const tree = await openTree(page);
  const treeBox = (await tree.boundingBox())!;
  await expect(row(tree, LONG_UNBROKEN).locator(".marquee")).toHaveAttribute("data-overflow", "");
  for (const name of [LONG_FOLDER, LONG_UNBROKEN, LONG_CHILD]) {
    const item = row(tree, name);
    await expect(item).toHaveAttribute("title", name);
    await expect(item.locator(".marquee")).toHaveAttribute("title", name);
    const box = (await item.boundingBox())!;
    expect(box.x + box.width, `${name} stays inside the tree`).toBeLessThanOrEqual(
      treeBox.x + treeBox.width + 1,
    );
    // Cut (and faded) exactly when it does not fit: a wide sheet may show a long name whole.
    const fit = await item.locator(".marquee").evaluate((el) => ({
      cut: el.hasAttribute("data-overflow"),
      overflows: el.firstElementChild!.scrollWidth > el.clientWidth + 1,
      mask: getComputedStyle(el).maskImage,
    }));
    expect(fit.cut, name).toBe(fit.overflows);
    expect(fit.mask).toMatch(fit.cut ? /linear-gradient/ : /^none$/);
  }
  // A name that fits is neither cut nor faded.
  await expect(row(tree, "Databases").locator(".marquee")).not.toHaveAttribute("data-overflow");
  // Every row is the same height, and every row's hit area is 44px without overlapping the next.
  const heights = await tree
    .getByRole("treeitem")
    .evaluateAll((items) => items.map((i) => Math.round(i.getBoundingClientRect().height)));
  expect(new Set(heights).size, `row heights ${heights.join(", ")}`).toBe(1);
  expect(await findLayoutIssues(page, { minTargetPx: 44, targetScope: '[role="tree"]' })).toEqual(
    [],
  );
  if (isWide(page)) {
    expect(await findLayoutIssues(page, { minTargetPx: 44, targetScope: "aside.sidebar" })).toEqual(
      [],
    );
  }
  await expectCleanScreen(page);
});

test("a child's chevron sits under its parent's folder, and deep rows keep room for the name", async ({
  page,
}) => {
  const tree = await openTree(page);
  const parent = row(tree, "Machine learning");
  const child = row(tree, LONG_CHILD);
  await expect(child).toBeVisible();
  const parentMark = (await parent.locator(".fmark").boundingBox())!;
  const childChevron = (await child.locator(".tree-disclosure").boundingBox())!;
  expect(Math.abs(childChevron.x - parentMark.x)).toBeLessThanOrEqual(1);
  // The icon column lines up across a level: every top-level folder glyph starts at one x.
  const tops = await tree
    .locator('[aria-level="1"] > .fmark')
    .evaluateAll((marks) => marks.map((m) => Math.round(m.getBoundingClientRect().left)));
  expect(new Set(tops).size).toBe(1);
  // The label keeps at least a quarter of the row however deep it sits.
  const label = (await child.locator(".marquee").boundingBox())!;
  const rowBox = (await child.boundingBox())!;
  expect(label.width).toBeGreaterThanOrEqual(rowBox.width / 4);
});

test("hover glides a cut name to its end and back; leaving eases it home", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const tree = await openTree(page);
  const item = row(tree, LONG_UNBROKEN);
  await item.hover();
  const glide = await glideOf(item);
  expect(glide, "a glide runs").not.toBeNull();
  expect(glide!.far).toMatch(/^translateX\(-\d+px\)$/);
  // At the far rest the whole end of the name is in view, clear of the fade.
  const far = await seek(item, 0.5);
  expect(far.textRight).toBeLessThanOrEqual(far.boxRight);
  expect(far.textLeft).toBeLessThan(far.boxLeft);
  // At the end of the run it is back at the start.
  const home = await seek(item, 1);
  expect(Math.abs(home.textLeft - home.boxLeft)).toBeLessThanOrEqual(1);
  // Leaving mid-glide eases back (a short settle) rather than snapping.
  await page.mouse.move(0, 0);
  await item.hover();
  await page.mouse.move(0, 0);
  const settle = await glideOf(item);
  expect(settle, "a settle runs").not.toBeNull();
  expect(settle!.duration).toBeLessThan(glide!.duration);
  // A name that fits never moves.
  await row(tree, "Databases").hover();
  expect(await glideOf(row(tree, "Databases"))).toBeNull();
});

test("keyboard focus glides the cut name too", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const tree = await openTree(page);
  const item = row(tree, LONG_UNBROKEN);
  await row(tree, "All notes").focus();
  // Walk down with the arrow keys until the long row has focus (keyboard focus is :focus-visible).
  for (let i = 0; i < 12 && !(await item.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(item).toBeFocused();
  expect(await glideOf(item)).not.toBeNull();
});

test("reduced motion: nothing moves; keyboard focus shows the full name in a tooltip", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = await openTree(page);
  const item = row(tree, LONG_UNBROKEN);
  await item.hover();
  expect(await movingAnimations(page, '[role="tree"]')).toEqual([]);
  expect(await glideOf(item)).toBeNull();

  await row(tree, "All notes").focus();
  for (let i = 0; i < 12 && !(await item.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(item).toBeFocused();
  const tip = page.locator(".marquee-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(LONG_UNBROKEN);
  // Laid over the cut label, inside the viewport.
  const tipBox = (await tip.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(tipBox.x).toBeGreaterThanOrEqual(0);
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(viewport.width);
  expect(await glideOf(item)).toBeNull();
  // Focus moves to a name that fits: the tooltip goes.
  await page.keyboard.press("Home");
  await expect(row(tree, "All notes")).toBeFocused();
  await expect(tip).toBeHidden();
});
