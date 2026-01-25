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

  it("blocks file: and other non-http(s) top-level navigations", async () => {
    const s = await open();
    const signal = new AbortController().signal;
    await s.goto(`${SITE}/`, signal);
    expect(await s.goto("file:///etc/hosts", signal)).toBe(false);
    expect(await s.goto("view-source:http://site.fixtures.test/", signal)).toBe(false);
    expect(await s.goto("chrome://version", signal)).toBe(false);
    expect(s.page.url()).toBe(`${SITE}/`);
    // A page-initiated top-level navigation is stopped by the route policy, not only by goto.
    await s.page
      .evaluate(() => void (window.location.href = "file:///etc/hosts"))
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(s.page.url()).not.toContain("file:");
  });

  it("blocks a redirect from an allowed origin to a name that resolves privately", async () => {
    // Only the redirect target resolves privately. Without the private check the redirect would
    // succeed: other.fixtures.test is reachable and allowlisted.
    const s = await open({
      testMode: false,
      allowedOrigins: () => [SITE, OTHER],
      resolveHost: async (host) =>
        host === "other.fixtures.test" ? ["10.0.0.5"] : ["93.184.216.34"],
    });
    s.drainPrivateConnections();
    expect(await s.goto(`${SITE}/redirect-other`, new AbortController().signal)).toBe(false);
    expect(s.page.url()).not.toContain("other.fixtures.test");
  });

  it("flags a response whose connected address is private even though the name looked public", async () => {
    // The resolver claims a public address; the slot really connects to the fixtures container
    // on a private IP, which serverAddr() reveals. The page is moved off it.
    const s = await open({ testMode: false, resolveHost: async () => ["93.184.216.34"] });
    expect(await s.goto(`${SITE}/`, new AbortController().signal)).toBe(false);
    const hits = s.drainPrivateConnections();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.topLevel).toBe(true);
    expect(hits[0]?.ip.startsWith("172.30.240.")).toBe(true);
    await expect.poll(() => s.page.url()).toBe("about:blank");
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
