import { OTHER_RUN_ID, RECORDED_RUN_ID, recordedSummary } from "../lib/fixtures/run-recording.ts";
import { mockRpc } from "./helpers/run.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("/runs lists every run with its status, each linking to its run view (X2)", async ({
  page,
}) => {
  await page.goto("/runs");
  const list = page.getByRole("navigation", { name: "Runs" });
  await expect(list.locator(`a[href="/runs/${RECORDED_RUN_ID}"]`)).toContainText(
    "Week 2 of the course",
  );
  await expect(list.locator(`a[href="/runs/${RECORDED_RUN_ID}"]`)).toContainText("Running");
  await expect(list.locator(`a[href="/runs/${OTHER_RUN_ID}"]`)).toContainText("Finished");
  await expect(list.locator(".smark").first()).toHaveAttribute("aria-hidden", "true");
  // Runs at every width: this is also the list's layout and axe check.
  await expectCleanScreen(page);
});

test("the runs list pages: Load more fetches the next page (M11)", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "paging check runs once");
  const first = recordedSummary();
  const second = {
    ...recordedSummary(),
    id: OTHER_RUN_ID,
    goal: "An older run",
    status: "completed",
  };
  await mockRpc(page, {
    "runs/list": (input) =>
      (input as { cursor?: string | null }).cursor
        ? { items: [second], nextCursor: null }
        : { items: [first], nextCursor: "page-2" },
  });
  await page.goto("/runs");
  const list = page.getByRole("navigation", { name: "Runs" });
  await expect(list.getByRole("link")).toHaveCount(1);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(list.getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("a run's goal is cleaned like any other untrusted text, in the list and the header (final M11)", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
  const goal = "Evil\u202Egoal\u200B here";
  await mockRpc(page, {
    "runs/list": () => ({ items: [{ ...recordedSummary(), goal }], nextCursor: null }),
  });
  await page.goto("/runs");
  const link = page
    .getByRole("navigation", { name: "Runs" })
    .locator(`a[href="/runs/${RECORDED_RUN_ID}"]`);
  await expect(link.locator(".run-list-goal")).toHaveText("Evilgoal here");
});
