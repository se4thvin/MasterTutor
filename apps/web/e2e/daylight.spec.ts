import type { Page } from "@playwright/test";
import { moved, readSamples, startSampling } from "./helpers/motion.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test.describe("Daylight motion", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "motion check runs once");

  test("a deleted note card fades and shrinks out instead of vanishing", async ({ page }) => {
    await page.goto("/library?folder=unfiled");
    // The grid's m.* animate only once the layout features have loaded (LayoutMotion, P1).
    await page.locator("html[data-layout-motion=ready]").waitFor({ state: "attached" });
    const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Unfiled clipping" });
    await card.getByRole("button", { name: /Actions for Unfiled clipping/ }).click();
    await page.getByRole("menuitem", { name: "Delete note…" }).click();
    // Sample the card every frame from the moment the delete is confirmed until it is gone.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('[data-qa="note-card"]')].find((c) =>
        c.textContent?.includes("Unfiled clipping"),
      );
      const slot = el?.parentElement;
      const samples: number[] = [];
      (window as { __exit?: number[] }).__exit = samples;
      const tick = () => {
        if (!slot?.isConnected) return;
        samples.push(Number(getComputedStyle(slot).opacity));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete Note" }).click();
    await expect(card).toBeHidden();
    const samples = await page.evaluate(() => (window as { __exit?: number[] }).__exit ?? []);
    expect(
      samples.some((o) => o > 0 && o < 1),
      samples.join(","),
    ).toBe(true);
  });

  test("the tree chevron rotates when a folder opens", async ({ page }) => {
    await page.goto("/library");
    const tree = page.getByRole("tree").first();
    const name =
      (await tree.getByRole("treeitem", { expanded: false }).first().getAttribute("aria-label")) ??
      (await tree.getByRole("treeitem", { expanded: false }).first().innerText());
    // Pinned by name: once open, it no longer matches `expanded: false`.
    const closed = tree.getByRole("treeitem", { name: name.trim(), exact: true }).first();
    const chevron = closed.locator(".tree-disclosure svg").first();
    await expect(chevron).toHaveCSS("rotate", "none");
    await closed.locator(".tree-disclosure").click();
    await expect(chevron).toHaveCSS("rotate", "90deg");
  });
});

test.describe("card reflow (parked: layout animation)", () => {
  async function deleteFirstCardWhileSampling(page: Page) {
    await page.goto("/library");
    await page.locator("html[data-layout-motion=ready]").waitFor({ state: "attached" });
    const cards = page.locator('[data-qa="note-card"]');
    const title = (await cards.first().locator(".card-title").innerText()).trim();
    await cards
      .first()
      .getByRole("button", { name: `Actions for ${title}` })
      .click();
    await page.getByRole("menuitem", { name: "Delete note…" }).click();
    const confirm = page.getByRole("alertdialog").getByRole("button", { name: "Delete Note" });
    // Wait until the dialog has settled (actionable) so the 40 sampled frames cover the reflow.
    await confirm.click({ trial: true });
    // The second slot is the card that has to move into the freed place.
    await startSampling(page, "reflow", ".card-slot:nth-child(2)", "transform", 40);
    await confirm.click();
    await expect(cards.filter({ hasText: title })).toBeHidden();
    return readSamples(page, "reflow", 40);
  }

  test("the cards after a deleted one slide into place instead of jumping", async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
    const samples = await deleteFirstCardWhileSampling(page);
    expect(samples.some(moved), samples.join(" | ")).toBe(true);
  });

  test("under reduced motion the cards jump into place", async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const samples = await deleteFirstCardWhileSampling(page);
    expect(samples.filter(moved), samples.join(" | ")).toEqual([]);
  });

  test("the library stays clean once layout motion has loaded", async ({ page }) => {
    await page.goto("/library");
    await page.locator("html[data-layout-motion=ready]").waitFor({ state: "attached" });
    await expectCleanScreen(page);
  });
});
