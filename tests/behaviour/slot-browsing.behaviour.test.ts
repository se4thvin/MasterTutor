import { chromium, type Browser } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { SITE, SLOT_CDP } from "./constants.ts";

// The slot browses like a normal Chrome profile (browse-freedom item 3): cross-site cookies on,
// a sign-in popup opened by a click opens, an unasked one is blocked, as in Chrome's defaults.
describe("slot browser settings", () => {
  let browser: Browser | undefined;
  afterEach(async () => {
    await browser?.close();
    browser = undefined;
  });
  const page = async () => {
    browser = await chromium.connectOverCDP(SLOT_CDP["browser-1"] ?? "", { timeout: 15_000 });
    const context = browser.contexts()[0]!;
    return { context, page: context.pages()[0] ?? (await context.newPage()) };
  };

  it("allows third-party cookies, by policy, like a normal Chrome profile (SSO)", async () => {
    const { page: p } = await page();
    await p.goto("chrome://settings/cookies", { waitUntil: "domcontentloaded" });
    const pref = await p.evaluate(
      () =>
        new Promise<{ value: unknown; enforcement?: string }>((resolve) =>
          (
            globalThis as unknown as {
              chrome: { settingsPrivate: { getPref(n: string, cb: (p: never) => void): void } };
            }
          ).chrome.settingsPrivate.getPref("profile.cookie_controls_mode", resolve),
        ),
    );
    // 0: allow third-party cookies; enforced by BlockThirdPartyCookies=false (policies.json).
    expect(pref).toMatchObject({ value: 0, enforcement: "ENFORCED" });
  });

  it("opens a sign-in popup a click asked for, even after an async request, and blocks an unasked one", async () => {
    const { context, page: p } = await page();
    await p.goto(`${SITE}/oauth-popup.html`, { waitUntil: "domcontentloaded" });
    const opened = context.waitForEvent("page", { timeout: 10_000 });
    await p.click("#provider");
    const popup = await opened;
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toBe("http://other.fixtures-isolated.test/index.html");
    await popup.close();

    const before = context.pages().length;
    await p.goto(`${SITE}/oauth-popup.html#unasked`, { waitUntil: "domcontentloaded" });
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForTimeout(1_500);
    expect(context.pages().length).toBe(before);
  });
});
