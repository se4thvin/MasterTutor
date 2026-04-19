import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("reader shows source strip, title and every block type, clean everywhere", async ({
  page,
}) => {
  await page.goto(NOTE);
  await expect(
    page.getByRole("heading", { level: 1, name: "Learning-rate warmup, explained" }),
  ).toBeVisible();
  await expect(page.locator(".srcstrip-url b")).toHaveText("fieldnotes.ml");
  await expect(page.locator(".katex-display")).toBeVisible();
  await expect(page.locator(".hljs-keyword").first()).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Figure 2/ })).toBeVisible();
  await expect(page.getByText("Agent's note").first()).toBeVisible();
  await expectCleanScreen(page);
});

test("gutter button opens the provenance popover with source details", async ({ page }) => {
  await page.goto(NOTE);
  await page.getByRole("button", { name: /Provenance for block 1:/ }).click();
  const pop = page.getByRole("dialog", { name: "Block provenance" });
  await expect(pop).toContainText("Page text");
  await expect(pop).toContainText("article > p");
  await expect(pop.getByRole("link", { name: "Open on page" })).toHaveAttribute(
    "href",
    /#:~:text=/,
  );
  await expectCleanScreen(page);
});

test("long titles, wide tables and code never push the page sideways (Review Focus 3)", async ({
  page,
}) => {
  await page.goto("/notes/00000000-0000-4000-8000-000002000010");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectCleanScreen(page);
});

test("a search hit scrolls to and highlights its block", async ({ page }) => {
  await page.goto("/library?q=grad_norm");
  await page.getByRole("list", { name: "Search results" }).getByRole("link").first().click();
  await expect(page.locator(".blk-flash")).toBeVisible();
});

test("a missing note shows a calm empty state", async ({ page }) => {
  await page.goto("/notes/00000000-0000-4000-8000-000002999999");
  await expect(page.getByRole("heading", { name: "This note isn't available" })).toBeVisible();
});

test("under reduced motion a picked block keeps a static highlight instead of a flash", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/library?q=grad_norm");
  await page.getByRole("list", { name: "Search results" }).getByRole("link").first().click();
  const flashed = page.locator(".blk-flash");
  await expect(flashed).toBeVisible();
  await expect
    .poll(() => flashed.evaluate((el) => getComputedStyle(el, "::before").opacity))
    .toBe("1");
  await expect
    .poll(() => flashed.evaluate((el) => getComputedStyle(el, "::before").animationName))
    .toBe("none");
});
