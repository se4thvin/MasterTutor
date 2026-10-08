import { expect, isWide, test } from "./helpers/test.ts";

// QA-017: a page view hydrates in its own Suspense boundary, after the shell. If the sidebar's
// folder tree has filled the shared query cache by then, the view must still render what the server
// rendered (no folders yet), or React throws #418 and client-renders the whole page.
test("the library hydrates cleanly after the sidebar has loaded the folders", async ({ page }) => {
  test.skip(!isWide(page), "the sidebar's folder tree shows only over 1180");
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));
  const foldersLoaded = page.waitForResponse((r) => r.url().includes("/api/rpc/folders/tree"));
  // Hold the library view's code until the sidebar's folders have arrived.
  let held = false;
  await page.route("**/_next/static/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("Loading notes")) {
      held = true;
      await foldersLoaded.then((r) => r.finished());
    }
    return route.fulfill({ response, body });
  });
  await page.goto("/library");
  await expect(page.locator('[data-qa="note-card"]').first()).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { name: "Folders" })).toBeVisible();
  // Without the hold (the marker copy changed) this would pass without testing the race.
  expect(held, "the library view's chunk was held").toBe(true);
  expect(uncaught).toEqual([]);
  // Idle prefetches may still be in the handler when the page closes.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
