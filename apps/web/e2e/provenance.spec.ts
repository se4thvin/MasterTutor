import { expect, expectCleanScreen, isWide, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("wide reader shows margin callouts whose leaders never cross content", async ({ page }) => {
  await page.goto(NOTE);
  const callouts = page.locator('[data-qa="callout"]');
  if (isWide(page)) {
    await expect(callouts.filter({ hasText: "Needs review." })).toBeVisible();
    await expect(callouts.filter({ hasText: "Edited by you." })).toBeVisible();
    await expect(page.locator('[data-qa="leaders"]')).toBeVisible();
  } else {
    await expect(callouts).toHaveCount(0);
    await expect(page.locator('[data-qa="leaders"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Provenance for block 1:/ })).toBeVisible();
  }
  await expectCleanScreen(page);
});

test("leaders stay inside the gutter column between the content and the captions", async ({
  page,
}) => {
  test.skip(!isWide(page), "callouts are wide-only");
  await page.goto(NOTE);
  await expect(page.locator('[data-qa="callout"]').first()).toBeVisible();
  const boxes = await page.evaluate(() => {
    const rect = (el: Element | null) => el?.getBoundingClientRect().toJSON() as DOMRect;
    const leaders = document.querySelector('[data-qa="leaders"]');
    const paths = Array.from(leaders?.querySelectorAll("path") ?? []).map((p) => rect(p));
    return {
      leaders: rect(leaders),
      content: rect(document.querySelector(".reader-content")),
      callouts: rect(document.querySelector(".callouts")),
      paths,
    };
  });
  expect(boxes.paths.length).toBeGreaterThan(0);
  expect(boxes.leaders.left).toBeGreaterThanOrEqual(boxes.content.right - 1);
  expect(boxes.leaders.right).toBeLessThanOrEqual(boxes.callouts.left + 1);
  for (const p of boxes.paths) {
    expect(p.left).toBeGreaterThanOrEqual(boxes.leaders.left - 1);
    expect(p.right).toBeLessThanOrEqual(boxes.leaders.right + 1);
  }
});

test("clicking a callout opens that block's provenance", async ({ page }) => {
  test.skip(!isWide(page), "callouts are wide-only");
  await page.goto(NOTE);
  await page.locator('[data-qa="callout"]').filter({ hasText: "Edited by you." }).click();
  await expect(page.getByRole("dialog", { name: "Block provenance" })).toContainText(
    "Edited by you",
  );
});
