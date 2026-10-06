import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { OTHER, SITE, SLOT_CDP } from "./constants.ts";

describe("behaviour stack", () => {
  it("reaches both fixture origins from a slot over published CDP", async () => {
    const browser = await chromium.connectOverCDP(SLOT_CDP["browser-1"] ?? "", { timeout: 15_000 });
    try {
      const context = browser.contexts()[0];
      const page = context?.pages()[0] ?? (await context!.newPage());
      await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });
      expect(await page.title()).toBe("Fixture article");
      await page.goto(`${OTHER}/`, { waitUntil: "domcontentloaded" });
      expect(await page.title()).toBe("Other origin");
    } finally {
      await browser.close();
    }
  });
});
