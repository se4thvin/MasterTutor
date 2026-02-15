import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("Mark verified springs, clears the review state and updates fidelity", async ({ page }) => {
  await page.goto(NOTE);
  const check = page.getByRole("checkbox", { name: "Mark verified" });
  await expect(check).not.toBeChecked();
  await expectCleanScreen(page);
  await check.click();
  await expect(page.getByRole("checkbox", { name: "Verified" })).toBeChecked();
  await expect(page.locator(".srcstrip").getByText("Verified", { exact: true })).toBeVisible();
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
