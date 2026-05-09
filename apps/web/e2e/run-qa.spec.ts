import type { Page } from "@playwright/test";
import { rec, recordedDetail, recordedEvents } from "../lib/fixtures/run-recording.ts";
import { movingAnimations } from "./helpers/motion.ts";
import { emit, frame, gotoRun } from "./helpers/run.ts";
import { expect, expectCleanScreen, isCompact, test } from "./helpers/test.ts";

async function openReplay(page: Page) {
  if (isCompact(page)) await page.getByRole("button", { name: /^Steps/ }).click();
  await page.getByRole("button", { name: "Replay step: Clicked “Log in”" }).click();
  if (isCompact(page)) {
    await page.keyboard.press("Escape");
    // Closing the sheet returns focus to the Steps button below the frame, which scrolls the page;
    // check the frame where a viewer sees it, not under the sticky toolbar.
    await page.locator("#main").evaluate((main) => main.scrollTo({ top: 0 }));
  }
}

const SCENARIOS: { name: string; state: string; setup(page: Page): Promise<void> }[] = [
  { name: "live", state: "live", setup: async (page) => void (await gotoRun(page)) },
  {
    name: "acting",
    state: "acting",
    setup: async (page) => {
      await gotoRun(page);
      await emit(page, [recordedEvents()[0]!]);
    },
  },
  {
    name: "approval",
    state: "approval",
    setup: async (page) => {
      await gotoRun(page);
      await emit(page, recordedEvents());
    },
  },
  {
    name: "control",
    state: "control",
    setup: async (page) =>
      void (await gotoRun(page, {
        detail: recordedDetail({ controller: "user", status: "waiting", waitReason: "takeover" }),
      })),
  },
  {
    name: "paused",
    state: "paused",
    setup: async (page) =>
      void (await gotoRun(page, {
        detail: recordedDetail({ status: "sleeping", slotName: null }),
      })),
  },
  {
    name: "reconnecting",
    state: "reconnecting",
    setup: async (page) => {
      await gotoRun(page);
      await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
      await page.evaluate(() => {
        window.__sse.blockOpen = true;
        window.__sse.fail(true);
      });
    },
  },
  {
    name: "replay",
    state: "replay",
    setup: async (page) => {
      await gotoRun(page);
      await openReplay(page);
    },
  },
  {
    name: "otp",
    state: "live",
    setup: async (page) => {
      await gotoRun(page);
      await emit(page, [
        rec({ type: "status", status: "waiting", waitReason: "otp", reason: null }),
      ]);
    },
  },
  {
    // D44 carry-over: the badge and the frame chip must fit at every width, 390 included.
    name: "bypass",
    state: "live",
    setup: async (page) => {
      await gotoRun(page, { detail: recordedDetail({ approvalMode: "bypass" }) });
      await expect(page.getByRole("note", { name: "Bypass mode" })).toBeVisible();
      await expect(frame(page).getByText("Bypass", { exact: true })).toBeVisible();
    },
  },
];

test.describe("F3 QA (D22): every width from the project, light and dark, layout and axe", () => {
  test("new task", async ({ page }) => {
    await page.goto("/new");
    await expect(page.getByRole("heading", { name: /Take notes on/ })).toBeVisible();
    await expectCleanScreen(page);
  });

  test("runs list", async ({ page }) => {
    await page.goto("/runs");
    await expect(page.getByRole("navigation", { name: "Runs" })).toBeVisible();
    await expectCleanScreen(page);
  });

  for (const s of SCENARIOS) {
    test(`run ${s.name}`, async ({ page }) => {
      await s.setup(page);
      await expect(frame(page)).toHaveAttribute("data-state", s.state, { timeout: 5_000 });
      await expectCleanScreen(page);
    });
  }
});

test("reduced motion: nothing in the run frame moves while the agent acts (X7)", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion check runs once");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoRun(page);
  await emit(page, [recordedEvents()[0]!]);
  await expect(frame(page)).toHaveAttribute("data-state", "acting");
  expect(await movingAnimations(page, ".run-frame")).toEqual([]);
});
