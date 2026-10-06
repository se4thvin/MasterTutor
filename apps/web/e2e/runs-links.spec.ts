import { ids } from "../lib/fixtures/ids.ts";
import { expect, test } from "./helpers/test.ts";

test.describe("run references link to the run view (X2)", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "content check runs once");

  for (const [where, path, href] of [
    ["usage", "/settings/usage", `/runs/${ids.run(2)}`],
    ["audit log", "/settings/audit", `/runs/${ids.run(1)}`],
    ["note source strip", `/notes/${ids.note(1)}`, `/runs/${ids.run(2)}`],
  ] as const) {
    test(`the ${where} links runs to /runs/<id>`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
    });
  }
});
