import { movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("Mark verified springs, clears the review state and updates fidelity", async ({ page }) => {
  await page.goto(NOTE);
  const check = page.getByRole("checkbox", { name: "Mark verified" });
  await expect(check).not.toBeChecked();
  await expectCleanScreen(page);
  await check.click();
  await expect(page.getByRole("checkbox", { name: "Verified" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Verified" })).toBeFocused();
  await expect(page.locator(".srcstrip").getByText("Verified", { exact: true })).toBeVisible();
});

test("a note with lost media stays partial after its last block is verified (one fidelity rule)", async ({
  page,
}) => {
  // Note 9 lost a keyframe: the server's rule (noteFidelity) says partial, never verified.
  await page.goto("/notes/00000000-0000-4000-8000-000002000009");
  await page.getByRole("checkbox", { name: "Mark verified" }).click();
  await expect(page.getByText("Marked verified")).toBeVisible();
  const strip = page.locator(".srcstrip");
  await expect(strip.getByText(/^Partial/)).toBeVisible();
  await expect(strip.getByText("Verified", { exact: true })).toHaveCount(0);
});

test("a failed verify rolls back and tells the user (Review Focus 5)", async ({ page }) => {
  await page.route("**/api/rpc/notes/markVerified", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto(NOTE);
  await page.getByRole("checkbox", { name: "Mark verified" }).click();
  await expect(
    page.getByRole("group").filter({ hasText: "Couldn't mark the block verified." }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Mark verified" })).not.toBeChecked();
});

test("keyboard focus stays on the check after verifying, and it cannot be unchecked", async ({
  page,
}) => {
  await page.goto(NOTE);
  const check = page.getByRole("checkbox", { name: "Mark verified" });
  await check.focus();
  await page.keyboard.press("Space");
  const done = page.getByRole("checkbox", { name: "Verified" });
  await expect(done).toBeChecked();
  await expect(done).toBeFocused();
  await expect(done).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Space");
  await expect(done).toBeChecked();
});

test("the note's verified count rolls up when a block is marked verified", async ({ page }) => {
  await page.goto(NOTE);
  const count = page.locator(".reader-head .rnum .sr-only");
  const before = Number(await count.innerText());
  await expectCleanScreen(page);
  await page.getByRole("checkbox", { name: "Mark verified" }).click();
  await expect(count).toHaveText(String(before + 1));
  await expect(page.locator(".reader-head")).toContainText("verified");
});

test("the verified count moves on a spring, and not at all under reduced motion", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
  await page.goto(NOTE);
  await startSampling(page, "count", ".reader-head .rnum-strip", "translate", 30);
  await page.getByRole("checkbox", { name: "Mark verified" }).click();
  const samples = await readSamples(page, "count", 30);
  expect(new Set(samples).size, samples.join(" | ")).toBeGreaterThan(2);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/notes/00000000-0000-4000-8000-000002000002");
  expect(await movingAnimations(page, ".reader-head")).toEqual([]);
});
