import { movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("usage shows totals, an accessible daily chart and per-run spend", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  await expect(page.getByRole("heading", { level: 1, name: /Usage/ })).toBeVisible();
  await expect(page.getByText("Spend", { exact: true }).first()).toBeVisible();
  const chart = page.getByRole("figure", { name: "Daily spend" });
  const bars = chart.locator("[data-qa='bar']");
  await expect(bars).toHaveCount(30);
  const first = bars.first();
  const tip = page.locator(`[id="${await first.getAttribute("aria-describedby")}"]`);
  await expect(tip).toHaveRole("tooltip");
  await expect(tip).toBeHidden();
  await first.focus();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Sep 6");
  await page.getByText("Show data").click();
  await expect(page.getByRole("table", { name: "Daily spend data" })).toBeVisible();
  await expectCleanScreen(page);
  await page
    .getByRole("radiogroup", { name: "Range" })
    .getByRole("radio", { name: "7 days" })
    .click();
  await expect(bars).toHaveCount(7);
  await expect(page.getByRole("cell", { name: /Learning-rate warmup, verbatim/ })).toBeVisible();
});

test("90 days stays clean at every width", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  await page
    .getByRole("radiogroup", { name: "Range" })
    .getByRole("radio", { name: "90 days" })
    .click();
  await expect(
    page.getByRole("figure", { name: "Daily spend" }).locator("[data-qa='bar']"),
  ).toHaveCount(90);
  await expectCleanScreen(page);
});

test("the chart is one tab stop; arrow keys move between days", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  const bars = page.getByRole("figure", { name: "Daily spend" }).locator("[data-qa='bar']");
  await expect(bars).toHaveCount(30);
  await expect(bars.and(page.locator("[tabindex='0']"))).toHaveCount(1);
  // The stop is the latest day.
  await expect(bars.last()).toHaveAttribute("tabindex", "0");
  await bars.last().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(bars.nth(28)).toBeFocused();
  await expect(bars.nth(28)).toHaveAttribute("tabindex", "0");
  await expect(bars.and(page.locator("[tabindex='0']"))).toHaveCount(1);
  await page.keyboard.press("Home");
  await expect(bars.first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(bars.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(bars.last()).toBeFocused();
  // Tab leaves the chart in one step.
  await page.keyboard.press("Tab");
  await expect(bars.last()).not.toBeFocused();
  expect(await bars.evaluateAll((els) => els.some((el) => el === document.activeElement))).toBe(
    false,
  );
});

test("usage that fails to load offers Retry", async ({ page }) => {
  await page.route("**/api/rpc/settings/usage", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto("/settings/usage");
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn't load usage." }).getByRole("button", {
      name: "Retry",
    }),
  ).toBeVisible({ timeout: 10_000 });
});

test("the chart is a labelled group that tells keyboard users about the arrow keys (parked)", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  const group = page.getByRole("group", { name: "Spend per day" });
  await expect(group).toHaveAccessibleDescription(/arrow keys/);
  const hint = page.locator("#chart-keys");
  await expect(hint).toHaveCSS("opacity", "0");
  await group.locator("[data-qa='bar']").last().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(hint).toHaveCSS("opacity", "1");
  await expectCleanScreen(page);
});

test("tiles roll to their values and bars grow from the baseline", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  await expect(page.locator(".tile .rnum").first()).toBeVisible();
  // W2: Spend's last digit keeps its key across ranges, so it rolls rather than remounts; first
  // make sure the value really changes between the two ranges.
  const spend = page.locator(".tile").filter({ hasText: "Spend" }).locator(".sr-only");
  const before = await spend.innerText();
  await startSampling(
    page,
    "roll",
    ".tile:first-child .rnum-col:last-child .rnum-strip",
    "translate",
    30,
  );
  await page
    .getByRole("radiogroup", { name: "Range" })
    .getByRole("radio", { name: "7 days" })
    .click();
  // The sampled strip is the last digit, so that is the digit that must change (M-8).
  await expect.poll(async () => (await spend.innerText()).slice(-1)).not.toBe(before.slice(-1));
  await expect(page.locator("[data-qa='bar']")).toHaveCount(7);
  await expect(page.locator("[data-qa='bar']").first()).toHaveCSS("animation-name", "bar-grow");
  const rolled = await readSamples(page, "roll", 30);
  expect(new Set(rolled).size, rolled.join(" | ")).toBeGreaterThan(2);
});

test("switching ranges keeps the tiles clean and readable (Review Focus 3)", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  const spend = page.locator(".tile").filter({ hasText: "Spend" }).locator(".sr-only");
  for (const range of ["7 days", "90 days", "30 days"]) {
    await page
      .getByRole("radiogroup", { name: "Range" })
      .getByRole("radio", { name: range })
      .click();
    await expect(spend).toHaveText(/^\$\d[\d,]*\.\d{2}$/);
    await expectCleanScreen(page);
  }
});

test("under reduced motion the numbers and bars do not move", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  await expect(page.locator("[data-qa='bar']")).toHaveCount(30);
  await page
    .getByRole("radiogroup", { name: "Range" })
    .getByRole("radio", { name: "7 days" })
    .click();
  expect(await movingAnimations(page, ".slist")).toEqual([]);
  await expect(page.locator(".tile .rnum-strip").first()).toHaveCSS(
    "transition-property",
    "opacity",
  );
});

test("a refetch that crosses midnight keeps keyboard focus on the chart (M-10)", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-05T23:59:00Z") });
  let calls = 0;
  await page.route("**/api/rpc/settings/usage", async (route) => {
    calls += 1;
    const response = await route.fetch();
    const body = (await response.json()) as {
      json: { perDay: Array<{ day: string; usd: number; runs: number; steps: number }> };
    };
    if (calls > 1) {
      // The window moved a day: the first day drops off and a new one is appended.
      const days = body.json.perDay;
      const last = days[days.length - 1]!;
      const next = new Date(`${last.day}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      body.json.perDay = [
        ...days.slice(1),
        { day: next.toISOString().slice(0, 10), usd: 0, runs: 0, steps: 0 },
      ];
    }
    return route.fulfill({ response, json: body });
  });
  await page.goto("/settings/usage");
  const bars = page.getByRole("group", { name: "Spend per day" }).locator("[data-qa='bar']");
  await expect(bars).toHaveCount(30);
  await bars.nth(28).focus();
  await page.keyboard.press("ArrowRight");
  await expect(bars.nth(29)).toBeFocused();
  await page.clock.fastForward("00:31");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => calls).toBe(2);
  await expect(bars).toHaveCount(30);
  // The focused day is still on screen, so its bar keeps focus (no remount of the bars).
  await expect(page.locator("[data-qa='bar']:focus")).toHaveCount(1);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
