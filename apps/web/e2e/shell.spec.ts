import { expect, expectCleanScreen, isCompact, isWide, test } from "./helpers/test.ts";

test("shell adapts: sidebar, icon rail or tab bar, with every destination reachable", async ({
  page,
}) => {
  await page.goto("/library");
  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const name of ["New task", "Runs", "Library", "Vault", "Settings"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  if (isWide(page)) {
    await expect(page.getByText("Recent notes")).toBeVisible();
  } else {
    await expect(page.getByText("Recent notes")).toBeHidden();
  }
  if (isCompact(page)) {
    const box = await nav.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan((page.viewportSize()?.height ?? 0) / 2);
  }
  await expectCleanScreen(page);
});

test("skip link moves focus to the main content", async ({ page }) => {
  await page.goto("/library");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("shows the kill-switch banner while the switch is on", async ({ page }) => {
  await page.request.post("/api/rpc/settings/setKillSwitch", { data: { json: { on: true } } });
  await page.goto("/library");
  await expect(page.getByRole("status").filter({ hasText: "Kill switch is on." })).toBeVisible();
});

test.describe("signed out", () => {
  test.use({ signedOut: true });
  test("redirects to sign-in", async ({ page }) => {
    await page.goto("/library");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
  test("keeps the design-system page behind sign-in", async ({ page }) => {
    await page.goto("/design");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
