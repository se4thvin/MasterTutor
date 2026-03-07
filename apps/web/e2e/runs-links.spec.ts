import { ids } from "../lib/fixtures/ids.ts";
import { expect, test } from "./helpers/test.ts";

// /runs/<id> is built in F3. Until then a run is named, never linked to a 404.
test.describe("run references before F3", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "content check runs once");

  for (const [where, path, text] of [
    ["usage", "/settings/usage", "Capture the learning-rate warmup article verbatim"],
    ["audit log", "/settings/audit", "origin mismatch"],
    ["note source strip", `/notes/${ids.note(1)}`, null],
  ] as const) {
    test(`the ${where} shows runs as text, not links`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      if (text) await expect(page.getByText(text).first()).toBeVisible();
      await expect(page.locator('a[href^="/runs/"]')).toHaveCount(0);
    });
  }
});
