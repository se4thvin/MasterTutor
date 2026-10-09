import type { Page } from "@playwright/test";
import { ids } from "../lib/fixtures/ids.ts";
import { settle } from "./helpers/clean-screen.ts";
import { frame } from "./helpers/run.ts";
import { RUN_SCENARIOS } from "./helpers/run-scenarios.ts";
import { expect, test } from "./helpers/test.ts";

/**
 * D22 visual baselines (P8-12): every fixture-mode screen at the five project widths, light and
 * dark. Pixels depend on fonts and the OS, so baselines are made and compared only on the remote
 * runner (scripts/remote-test.sh ui, which sets MT_CI_RUN_ID: Linux, pinned Chromium); elsewhere
 * this file skips. A missing baseline fails (updateSnapshots "none"); write one only on purpose:
 *   scripts/remote-test.sh ui e2e/visual.spec.ts --update-snapshots=missing
 */
test.skip(
  !process.env["MT_CI_RUN_ID"],
  "visual baselines run on the remote runner only (scripts/remote-test.sh ui)",
);

const NOW = new Date("2026-10-05T15:00:00Z");

// A baseline is the loaded screen, never a skeleton: every RPC has answered and no region is busy.
const pendingRpc = new WeakMap<Page, Set<unknown>>();
test.beforeEach(({ page }) => {
  const pending = new Set<unknown>();
  pendingRpc.set(page, pending);
  page.on("request", (r) => void (r.url().includes("/api/rpc/") && pending.add(r)));
  page.on("requestfinished", (r) => void pending.delete(r));
  page.on("requestfailed", (r) => void pending.delete(r));
});

async function loaded(page: Page): Promise<void> {
  // Quiet for 300 ms: hydration may start a query just after the first paint.
  const pending = pendingRpc.get(page)!;
  let quietSince = Date.now();
  const deadline = Date.now() + 15_000;
  while (Date.now() - quietSince < 300) {
    if (Date.now() > deadline) throw new Error(`RPCs still in flight: ${pending.size}`);
    if (pending.size > 0) quietSince = Date.now();
    await page.waitForTimeout(50);
  }
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  // Pip's arrival wave is over and its poster is decoded: the shot shows Pip at rest.
  await expect(page.locator('.pip[data-state="waving"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator("img.pip-poster")
        .evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true);
}

async function expectScreenshots(page: Page, name: string): Promise<void> {
  await loaded(page);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}-${colorScheme}.png`, {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.002,
    });
  }
}

const PAGES = [
  ["new-task", "/new"],
  ["runs", "/runs"],
  ["library", "/library"],
  ["library-folder", `/library?folder=${ids.folder(2)}`],
  ["note", `/notes/${ids.note(1)}`],
  ["vault", "/vault"],
  ["settings", "/settings"],
  ["settings-usage", "/settings/usage"],
  ["settings-audit", "/settings/audit"],
  ["settings-alerts", "/settings/alerts"],
] as const;

test.describe("signed out", () => {
  test.use({ signedOut: true });
  for (const [name, path] of [
    ["sign-in", "/sign-in"],
    ["sign-up", "/sign-up"],
  ] as const) {
    test(`visual ${name}`, async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectScreenshots(page, name);
    });
  }
});

for (const [name, path] of PAGES) {
  test(`visual ${name}`, async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await expectScreenshots(page, name);
  });
}

for (const s of RUN_SCENARIOS) {
  test(`visual run ${s.name}`, async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await s.setup(page);
    await expect(frame(page)).toHaveAttribute("data-state", s.state, { timeout: 5_000 });
    await expectScreenshots(page, `run-${s.name}`);
  });
}
