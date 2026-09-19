import { recordedEvents } from "../lib/fixtures/run-recording.ts";
import { movingAnimations } from "./helpers/motion.ts";
import { emit, frame, gotoRun } from "./helpers/run.ts";
import { RUN_SCENARIOS } from "./helpers/run-scenarios.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

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

  for (const s of RUN_SCENARIOS) {
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
