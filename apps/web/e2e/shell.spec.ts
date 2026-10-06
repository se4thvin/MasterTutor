import type { Page, Route } from "@playwright/test";
import { movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";
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

test("shows the kill-switch banner while the switch is on", async ({ page, baseURL }) => {
  await page.request.post("/api/rpc/settings/setKillSwitch", {
    data: { json: { on: true } },
    headers: { origin: new URL(baseURL!).origin },
  });
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

  /** The one live region that announces a run's outcome. */
  const outcome = (page: Page) => page.locator(".sidebar [data-qa=run-outcome]");

  async function finishRun(
    page: Page,
    runGet: (route: Route) => Promise<void>,
    runs = 1,
    /** Ids still running in each later list response; default: none. */
    later: string[][] = [[]],
  ) {
    await page.clock.install({ time: new Date("2026-10-05T17:00:00Z") });
    let lists = 0;
    let firstItems: Array<{ id: string }> = [];
    await page.route("**/api/rpc/runs/list", async (route) => {
      lists += 1;
      if (lists > 1) {
        const still = later[Math.min(lists - 2, later.length - 1)] ?? [];
        const items = firstItems.filter((r) => still.includes(r.id));
        return route.fulfill({ json: { json: { items, nextCursor: null } } });
      }
      const response = await route.fetch();
      const body = (await response.json()) as { json: { items: Array<{ id: string }> } };
      // Optionally a second running run, so two finish together.
      if (runs === 2) body.json.items.push({ ...body.json.items[0]!, id: SECOND_RUN });
      firstItems = body.json.items;
      return route.fulfill({ response, json: body });
    });
    await page.route("**/api/rpc/runs/get", runGet);
    await page.goto("/library");
    await expect(runsLink(page).locator('.smark[data-status="running"]')).toBeVisible();
    // Tag the mark: the outcome must morph this same element, not a remount (I-1).
    await runsLink(page)
      .locator(".smark")
      .evaluate((el: HTMLElement) => (el.dataset["k"] = "kept"));
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
    await expect(runsLink(page).locator('.smark[data-status="done"][data-k="kept"]')).toBeVisible();
    await expect(runsLink(page)).toContainText("Run finished");
    // Announced once, outside the link, so the link's name does not churn (I-2).
    await expect(outcome(page)).toHaveText("Run finished");
    await page.clock.fastForward(2500);
    // The badge fades out (durations.base), then unmounts.
    await page.clock.runFor(300);
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
    // Nothing to flash: the running badge fades out (durations.base), then unmounts.
    await page.clock.runFor(300);
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
    await expect(
      runsLink(page).locator('.smark[data-status="failed"][data-k="kept"]'),
    ).toBeVisible();
    await expect(runsLink(page)).toContainText("Run failed");
    await expect(outcome(page)).toHaveText("Run failed");
  });

  test("a failure is kept when another run finishes while it is being fetched (m-1)", async ({
    page,
  }) => {
    let releaseFirst: () => void = () => undefined;
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    await finishRun(
      page,
      async (route) => {
        if (route.request().postData()?.includes(SECOND_RUN)) {
          return route.fulfill({ json: { json: { id: SECOND_RUN, status: "completed" } } });
        }
        await firstHeld;
        return route.fulfill({ json: { json: { id: RUN, status: "failed" } } });
      },
      2,
      // The first list drops only RUN; the next drops SECOND_RUN too.
      [[SECOND_RUN], []],
    );
    // RUN's details are still in flight when SECOND_RUN leaves the list too.
    const secondGet = page.waitForRequest(
      (r) => r.url().includes("/runs/get") && (r.postData() ?? "").includes(SECOND_RUN),
    );
    await page.clock.fastForward("00:31");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await secondGet;
    releaseFirst();
    await expect(runsLink(page).locator('.smark[data-status="failed"]')).toBeVisible();
    await expect(outcome(page)).toHaveText("Run failed");
  });

  test("the outcome fades out instead of vanishing (m-10)", async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
    await finishRun(page, (route) =>
      route.fulfill({ json: { json: { id: RUN, status: "completed" } } }),
    );
    const meta = runsLink(page).locator(".nav-meta");
    await expect(meta.locator('.smark[data-status="done"]')).toBeVisible();
    await page.clock.runFor(2400);
    await expect(meta).toHaveAttribute("data-leaving", "");
    // Let real time run, so the CSS fade and the unmount timer play out.
    await page.clock.resume();
    await startSampling(page, "fade", ".nav .nav-meta", "opacity", 30);
    const samples = (await readSamples(page, "fade", 30)).filter(Boolean).map(Number);
    expect(
      samples.some((o) => o > 0 && o < 1),
      samples.join(","),
    ).toBe(true);
    await expect(meta).toHaveCount(0);
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

test("under reduced motion the toolbar hairline stays hidden at the top of the page", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/library");
  const toolbar = page.locator(".toolbar").first();
  await expect(toolbar).toBeVisible();
  // The scroll-linked fade must keep its scroll mapping: hidden until the page scrolls...
  expect(await toolbar.evaluate((el) => getComputedStyle(el, "::after").opacity)).toBe("0");
  // ...then shown once it has (the range is 0–1rem of scroll).
  await page.locator("#main").evaluate((main) => main.scrollTo(0, 64));
  await expect
    .poll(() => toolbar.evaluate((el) => getComputedStyle(el, "::after").opacity))
    .toBe("1");
});

test("a compact page whose main has nothing to focus can still be scrolled by keyboard (M-3)", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 390, "the compact audit log is the case");
  await page.goto("/settings/audit");
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await expectCleanScreen(page);
  // Tab reaches the scrolling main, and the keyboard scrolls it.
  const main = page.locator("#main");
  for (let i = 0; i < 30 && !(await main.evaluate((m) => m === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(main).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect.poll(() => main.evaluate((m) => m.scrollTop)).toBeGreaterThan(0);
});
