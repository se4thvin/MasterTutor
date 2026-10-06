import { expect, test } from "./helpers/test.ts";

test.describe("Daylight motion", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "motion check runs once");

  test("a deleted note card fades and shrinks out instead of vanishing", async ({ page }) => {
    await page.goto("/library?folder=unfiled");
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
