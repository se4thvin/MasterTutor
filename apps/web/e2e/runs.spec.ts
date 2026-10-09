import {
  OTHER_RUN_ID,
  RECORDED_RUN_ID,
  rec,
  recordedDetail,
  recordedSummary,
} from "../lib/fixtures/run-recording.ts";
import { emit, gotoRun, mockRpc } from "./helpers/run.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("/runs lists every run with its status, each linking to its run view (X2)", async ({
  page,
}) => {
  await page.goto("/runs");
  const list = page.getByRole("navigation", { name: "Runs" });
  // Each run shows its short title, not its goal.
  await expect(list.locator(`a[href="/runs/${RECORDED_RUN_ID}"]`)).toContainText(
    "Week 2 lectures, figures and tables",
  );
  await expect(list).not.toContainText("Week 2 of the course");
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

test("a run's title is cleaned like any other untrusted text and shown as text (final M11)", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
  const title = "Evil\u202Etitle\u200B <b>here</b>";
  await mockRpc(page, {
    "runs/list": () => ({ items: [{ ...recordedSummary(), title }], nextCursor: null }),
  });
  await page.goto("/runs");
  const link = page
    .getByRole("navigation", { name: "Runs" })
    .locator(`a[href="/runs/${RECORDED_RUN_ID}"]`);
  await expect(link.locator(".run-list-goal")).toHaveText("Eviltitle <b>here</b>");
  await expect(link.locator("b")).toHaveCount(0);
});

test("the run header shows the title, then the generated one as it streams in, as text", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
  await gotoRun(page, { detail: recordedDetail({ title: "learn.example.edu" }) });
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("learn.example.edu");
  await emit(page, [rec({ type: "title", title: "Week 2 <i>notes</i>\u202E" })]);
  await expect(heading).toHaveText("Week 2 <i>notes</i>");
  await expect(heading.locator("i")).toHaveCount(0);
});
