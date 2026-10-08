import { expectCleanScreen } from "../../helpers/clean-screen.ts";
import { expect, test } from "@playwright/test";
import { openScreen } from "./qa-page.ts";
import { SCREENS } from "./screens.ts";

/**
 * Real-stack wiring smoke (P8-12): every catalog screen renders seeded data from Postgres through
 * the live oRPC router and the SSE route, with no 5xx (NOT_IMPLEMENTED is 501) and no page error,
 * then passes fe's layout + axe check in light and dark. Pixels belong to fe's fixture-mode visual
 * suite; 44px targets and the swarm's eye belong to the shooter (Task 9).
 */
for (const screen of SCREENS) {
  test.describe(`${screen.group} ${screen.id}`, () => {
    if (screen.signedOut) test.use({ storageState: { cookies: [], origins: [] } });

    test("renders seeded data with no server error and a clean layout", async ({ page }) => {
      const failures: string[] = [];
      page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
      page.on("response", (response) => {
        if (response.url().includes("/api/") && response.status() >= 500) {
          failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
        }
      });
      await openScreen(page, screen);
      await expectCleanScreen(page);
      expect(failures).toEqual([]);
    });
  });
}
