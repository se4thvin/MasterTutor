import type { Page } from "@playwright/test";
import { ids } from "../lib/fixtures/ids.ts";
import { expect, test } from "./helpers/test.ts";

/** Unique strings from inside KaTeX and highlight.js, so we can tell whether their code shipped. */
const KATEX = "KaTeX parse error";
const HIGHLIGHT = "Falling back to no-highlight";

/** Every script the page downloaded, once it has hydrated and rendered `ready`. */
async function loadedScripts(page: Page, path: string, ready: string): Promise<string> {
  const bodies: Array<Promise<string>> = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") bodies.push(res.text().catch(() => ""));
  });
  await page.goto(path);
  await page.locator("html[data-hotkeys=ready]").waitFor({ state: "attached" });
  await page.locator(ready).first().waitFor();
  return (await Promise.all(bodies)).join("\n");
}

test.describe("note page weight", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "bundle check runs once");

  test("a note without math or code never downloads KaTeX or highlight.js", async ({ page }) => {
    const js = await loadedScripts(page, `/notes/${ids.note(8)}`, "h1");
    await expect(page.getByRole("heading", { level: 1, name: "Unfiled clipping" })).toBeVisible();
    expect(js.includes(KATEX), "KaTeX shipped").toBe(false);
    expect(js.includes(HIGHLIGHT), "highlight.js shipped").toBe(false);
  });

  test("a note with math and code loads them and typesets", async ({ page }) => {
    const js = await loadedScripts(page, `/notes/${ids.note(1)}`, ".katex-display");
    expect(js.includes(KATEX), "KaTeX loaded").toBe(true);
    expect(js.includes(HIGHLIGHT), "highlight.js loaded").toBe(true);
    await expect(page.locator(".katex-display").first()).toBeVisible();
    await expect(page.locator(".hljs-keyword").first()).toBeVisible();
  });
});
