import type { Page } from "@playwright/test";
import { ids } from "../lib/fixtures/ids.ts";
import { gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

/**
 * Spec §11.1: one typeface. Every rendered text uses --font-ui (SF Pro on Apple platforms);
 * only note code blocks (.prose pre, inline .prose code) use --font-code. The CSS lint proves
 * the stylesheets; this proves the page, including what the browser and preflight default
 * (code, kbd, pre, form controls).
 */
async function offFamilyTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = (family: string) => {
      const el = document.createElement("span");
      el.style.fontFamily = family;
      document.body.append(el);
      const value = getComputedStyle(el).fontFamily;
      el.remove();
      return value;
    };
    const ui = probe(root.getPropertyValue("--font-ui"));
    const code = probe(root.getPropertyValue("--font-code"));
    const off: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      const ownText = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
      const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if ((!ownText && !isField) || el.closest("svg, canvas, .katex")) continue;
      const family = getComputedStyle(el).fontFamily;
      const inCode = el.closest(".prose pre, .prose code") !== null;
      if (family !== (inCode ? code : ui))
        off.push(`<${el.localName} class="${el.className}">: ${family}`);
    }
    return off;
  });
}

const SCREENS: Array<[string, (page: Page) => Promise<unknown>]> = [
  ["new task", (page) => page.goto("/new")],
  ["run", (page) => gotoRun(page)],
  ["note with code blocks", (page) => page.goto(`/notes/${ids.note(1)}`)],
  ["vault", (page) => page.goto("/vault")],
  ["audit", (page) => page.goto("/settings/audit")],
  ["usage chart", (page) => page.goto("/settings/usage")],
  ["design system", (page) => page.goto("/design")],
];

// The design page's skeleton demo ("Loading example") is aria-busy for good.
const LOADING = 'main [aria-busy="true"]:not([aria-label="Loading example"])';

for (const [name, open] of SCREENS) {
  test(`${name} renders all text in the one typeface`, async ({ page }) => {
    await open(page);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.locator(LOADING)).toHaveCount(0);
    expect(await offFamilyTexts(page)).toEqual([]);
  });
}

test("note code blocks keep SF Mono", async ({ page }) => {
  await page.goto(`/notes/${ids.note(1)}`);
  await expect(page.locator(".reader-content pre code").first()).toHaveCSS(
    "font-family",
    /^ui-monospace/,
  );
});
