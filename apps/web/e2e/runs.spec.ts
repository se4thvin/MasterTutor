import { OTHER_RUN_ID, RECORDED_RUN_ID } from "../lib/fixtures/run-recording.ts";
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
