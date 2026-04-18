import type { Page, Route } from "@playwright/test";
import { movingAnimations } from "./helpers/motion.ts";
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

test.describe("Runs badge (StatusMark)", () => {
  const runsLink = (page: Page) =>
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Runs/ });

  test("pulses the live dot while a run is running, at every width", async ({ page }) => {
    await page.goto("/library");
    await expect(runsLink(page).locator('.smark[data-status="running"]')).toBeVisible();
    await expect(runsLink(page)).toContainText("1 live");
    await expectCleanScreen(page);
  });

  const RUN = "00000000-0000-4000-8000-000008000001";
  const SECOND_RUN = "00000000-0000-4000-8000-000008000099";

  async function finishRun(page: Page, runGet: (route: Route) => Promise<void>, runs = 1) {
    await page.clock.install({ time: new Date("2026-10-05T17:00:00Z") });
    let lists = 0;
    await page.route("**/api/rpc/runs/list", async (route) => {
      lists += 1;
      if (lists > 1) return route.fulfill({ json: { json: { items: [], nextCursor: null } } });
      if (runs === 1) return route.continue();
      // A second running run, so two finish at once.
      const response = await route.fetch();
      const body = (await response.json()) as { json: { items: Array<{ id: string }> } };
      const first = body.json.items[0]!;
      body.json.items.push({ ...first, id: SECOND_RUN });
      return route.fulfill({ response, json: body });
    });
    await page.route("**/api/rpc/runs/get", runGet);
    await page.goto("/library");
    await expect(runsLink(page).locator('.smark[data-status="running"]')).toBeVisible();
    // Past staleTime, then a reconnect: React Query refetches the list (no polling involved).
    await page.clock.fastForward("00:31");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await expect.poll(() => lists).toBe(2);
  }

  test("when the run completes, the dot morphs into a check, then clears", async ({ page }) => {
    await finishRun(page, (route) =>
      route.fulfill({ json: { json: { id: RUN, status: "completed" } } }),
    );
    await expect(runsLink(page).locator('.smark[data-status="done"]')).toBeVisible();
    await expect(runsLink(page)).toContainText("Run finished");
    await page.clock.fastForward(2500);
    await expect(runsLink(page).locator(".nav-meta")).toHaveCount(0);
  });

  test("a finished run that can't be fetched clears the badge quietly (Review Focus 5)", async ({
    page,
  }) => {
    let gets = 0;
    await finishRun(page, (route) => {
      gets += 1;
      return route.fulfill({ status: 404, json: { json: { code: "NOT_FOUND" } } });
    });
    // The details were asked for, and the one retry was spent, before judging the badge (W1).
    await expect.poll(() => gets).toBe(1);
    await page.clock.runFor(1500);
    await expect.poll(() => gets).toBe(2);
    await expect(runsLink(page).locator(".nav-meta")).toHaveCount(0);
    await expect(runsLink(page).locator('.smark[data-status="running"]')).toHaveCount(0);
    await expect(page.getByRole("group").filter({ hasText: /Couldn't/ })).toHaveCount(0);
  });

  test("when several runs finish at once, failure wins (Review Focus 5)", async ({ page }) => {
    await finishRun(
      page,
      (route) =>
        route.request().postData()?.includes(SECOND_RUN)
          ? route.fulfill({ json: { json: { id: SECOND_RUN, status: "failed" } } })
          : route.fulfill({ status: 404, json: { json: { code: "NOT_FOUND" } } }),
      2,
    );
    // The 404 is retried once before the outcome is known.
    await page.clock.runFor(1500);
    await expect(runsLink(page).locator('.smark[data-status="failed"]')).toBeVisible();
    await expect(runsLink(page)).toContainText("Run failed");
  });

  test("under reduced motion the live dot does not pulse", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/library");
    await expect(runsLink(page).locator('.smark[data-status="running"]')).toBeVisible();
    expect(await movingAnimations(page, ".nav")).toEqual([]);
    expect(
      await runsLink(page)
        .locator(".smark-dot")
        .evaluate((el) => getComputedStyle(el).animationDuration),
    ).toBe("0.001s");
  });
});
