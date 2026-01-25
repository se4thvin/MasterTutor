import { createLogger } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { OTHER, SITE, SLOT_CDP } from "../../../../tests/behaviour/constants.ts";
import { ControlHeld } from "../runtime/errors.ts";
import { BrowserSession } from "./session.ts";
import { settle } from "./settle.ts";

const log = createLogger({ service: "test", level: "silent" });
let session: BrowserSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function open(overrides: Partial<Parameters<typeof BrowserSession.connect>[0]> = {}) {
  session = await BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP["browser-1"] ?? "",
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
    ...overrides,
  });
  return session;
}

describe("BrowserSession", () => {
  it("measures the real page viewport, which is shorter than the 1280x800 window", async () => {
    const s = await open();
    await s.goto(`${SITE}/interactive.html`, new AbortController().signal);
    const layout = await s.layout();
    expect(layout.width).toBeGreaterThan(1000);
    expect(layout.height).toBeLessThan(800);
  });

  it("blocks top-level navigation to an origin outside the allowlist and records it", async () => {
    const s = await open();
    expect(await s.goto(`${OTHER}/steal`, new AbortController().signal)).toBe(false);
    expect(s.drainBlockedNavigations()).toEqual([{ url: `${OTHER}/steal`, origin: OTHER }]);
    expect(s.page.url()).not.toContain("other.fixtures.test");
  });

  it("blocks private and metadata addresses even when their origin is allowed", async () => {
    // Both origins are on the allowlist, so only the private-range check can stop them: nothing is
    // recorded as a blocked (allowlist) navigation.
    const s = await open({
      allowedOrigins: () => [
        SITE,
        "http://169.254.169.254",
        "http://127.0.0.1:9222",
        "http://[::ffff:a00:1]",
      ],
    });
    const signal = new AbortController().signal;
    const started = Date.now();
    expect(await s.goto("http://169.254.169.254/latest/meta-data", signal)).toBe(false);
    expect(await s.goto("http://127.0.0.1:9222/json/version", signal)).toBe(false);
    expect(await s.goto("http://[::ffff:a00:1]/", signal)).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(s.drainBlockedNavigations()).toEqual([]);
  });

  it("blocks a name that resolves to a private address even when its origin is allowed", async () => {
    // site.fixtures.test is reachable from the slot, so without the private-range check this
    // navigation would succeed. testMode is off, so the fixture bypass does not apply.
    const s = await open({ testMode: false, resolveHost: async () => ["10.0.0.5"] });
    expect(await s.goto(`${SITE}/`, new AbortController().signal)).toBe(false);
    expect(s.drainBlockedNavigations()).toEqual([]);
    expect(s.page.url()).not.toContain("fixtures.test");
  });

  it("guards every action while the user holds control", async () => {
    const s = await open();
    s.guard.hold();
    await expect(s.goto(`${SITE}/`, new AbortController().signal)).rejects.toBeInstanceOf(
      ControlHeld,
    );
    s.guard.release();
  });

  it("settles after a delayed DOM update and after a navigation", async () => {
    const s = await open();
    const signal = new AbortController().signal;
    await s.goto(`${SITE}/interactive.html`, signal);
    await s.page.evaluate(() => (document.getElementById("later") as HTMLButtonElement).click());
    await settle(s, signal);
    expect(await s.page.locator("#late").count()).toBe(1);
    await s.page.evaluate(() =>
      (document.querySelector('a[href="/page2"]') as HTMLAnchorElement).click(),
    );
    await settle(s, signal);
    expect(s.page.url()).toBe(`${SITE}/page2`);
  });
});
