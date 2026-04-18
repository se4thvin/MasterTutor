import { expect, expectCleanScreen, isCompact, test } from "./helpers/test.ts";

const fail = { status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } };

test.describe("error states offer Retry, never a false empty state", () => {
  test("library", async ({ page }) => {
    await page.route("**/api/rpc/notes/list", (route) => route.fulfill(fail));
    await page.goto("/library");
    const error = page.getByRole("alert").filter({ hasText: "Couldn't load your notes." });
    await expect(error).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Nothing here yet")).toBeHidden();
    await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
    await expectCleanScreen(page);
  });

  test("vault", async ({ page }) => {
    await page.route("**/api/rpc/vault/list", (route) => route.fulfill(fail));
    await page.goto("/vault");
    const error = page.getByRole("alert").filter({ hasText: "Couldn't load your sign-ins." });
    await expect(error).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("No sign-ins yet")).toBeHidden();
    await expectCleanScreen(page);
  });

  test("audit log", async ({ page }) => {
    await page.route("**/api/rpc/vault/audit", (route) => route.fulfill(fail));
    await page.goto("/settings/audit");
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't load the audit log." }),
    ).toBeVisible({ timeout: 10_000 });
    await expectCleanScreen(page);
  });
});

test.describe("empty states are clean", () => {
  test("library", async ({ page }) => {
    await page.route("**/api/rpc/notes/list", (route) =>
      route.fulfill({ json: { json: { items: [], nextCursor: null } } }),
    );
    await page.goto("/library");
    // The folder tiles stay above it, so the empty state speaks of notes only (I5).
    await expect(page.getByRole("heading", { name: "No notes in this folder yet" })).toBeVisible();
    await expectCleanScreen(page);
  });

  test("vault", async ({ page }) => {
    await page.route("**/api/rpc/vault/list", (route) =>
      route.fulfill({ json: { json: { items: [] } } }),
    );
    await page.goto("/vault");
    await expect(page.getByRole("heading", { name: "No sign-ins yet" })).toBeVisible();
    await expectCleanScreen(page);
  });

  for (const path of ["/new", "/runs"]) {
    test(`${path} placeholder`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await expectCleanScreen(page);
    });
  }
});

test.describe("open overlays are clean", () => {
  test("a note card's action menu", async ({ page }) => {
    await page.goto("/library");
    const card = page.locator('[data-qa="note-card"]').first();
    await card.getByRole("button", { name: /^Actions for/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectCleanScreen(page);
  });

  test("the user menu", async ({ page }) => {
    test.skip(isCompact(page), "the user menu lives in the sidebar on regular widths");
    await page.goto("/library");
    await page.getByRole("button", { name: /^Account:/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectCleanScreen(page);
  });

  test("a stack of toasts", async ({ page }) => {
    await page.route("**/api/rpc/vault/forgetSession", (route) => route.fulfill(fail));
    await page.goto("/vault");
    for (const alias of ["github", "medium", "github"]) {
      await page.getByRole("button", { name: `Sign out of ${alias}` }).click();
      await expect(page.getByRole("button", { name: `Sign out of ${alias}` })).toBeVisible();
    }
    await expect(page.getByRole("group").filter({ hasText: "Couldn't sign out." })).toHaveCount(3);
    const region = page.getByRole("region", { name: "Notifications" });
    // Hovering pauses the countdowns; then wait out motion's JS entrance spring, which settle()
    // cannot see, so axe samples finished toasts.
    await region.hover();
    await expect
      .poll(() =>
        region.evaluate((el) =>
          [...el.querySelectorAll("*")].every((node) => getComputedStyle(node).opacity === "1"),
        ),
      )
      .toBe(true);
    // Past a toast's 5s life: holding the stack keeps every toast, not just the hovered one.
    await page.waitForTimeout(5_500);
    await expect(page.getByRole("group").filter({ hasText: "Couldn't sign out." })).toHaveCount(3);
    await expectCleanScreen(page);
  });
});
