import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { ControlHeld } from "../runtime/errors.ts";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { MAX_SCROLL_VIEWPORTS, preparePage } from "./prepare.ts";

let session: BrowserSession;
const signal = new AbortController().signal;
beforeAll(async () => {
  session = await openTestSession();
});
afterAll(async () => {
  await session?.close();
});

describe("preparePage", () => {
  it("loads lazy batches until the height is stable and restores scroll", async () => {
    await session.goto(`${FIXTURES}/capture/lazy/index.html`, signal);
    const result = await preparePage(session, signal);
    expect(result.heightStable).toBe(true);
    const state = await session.page.evaluate(() => ({
      batches: document.querySelectorAll(".batch").length,
      imagesLoaded: [...document.images].every((img) => img.complete && img.naturalWidth > 0),
      scrollY,
    }));
    expect(state).toEqual({ batches: 3, imagesLoaded: true, scrollY: 0 });
  });

  it("caps infinite scroll at MAX_SCROLL_VIEWPORTS", async () => {
    await session.goto(`${FIXTURES}/capture/infinite/index.html`, signal);
    expect(await preparePage(session, signal)).toMatchObject({
      viewports: MAX_SCROLL_VIEWPORTS,
      heightStable: false,
    });
  }, 120_000);

  it("stops when aborted and never scrolls while the user holds control", async () => {
    await session.goto(`${FIXTURES}/capture/infinite/index.html`, signal);
    const controller = new AbortController();
    controller.abort();
    await expect(preparePage(session, controller.signal)).rejects.toThrow(/abort/i);
    session.guard.hold();
    try {
      await expect(preparePage(session, signal)).rejects.toBeInstanceOf(ControlHeld);
      expect(await session.page.evaluate(() => scrollY)).toBe(0);
    } finally {
      session.guard.release();
    }
  });
  it("re-checks control right before the first mutation (M5)", async () => {
    await session.goto(`${FIXTURES}/capture/docs/index.html`, signal);
    // The person takes over while the capture world is being set up.
    const cdp = session.cdp.bind(session);
    session.cdp = async () => {
      session.guard.hold();
      return cdp();
    };
    try {
      await expect(preparePage(session, signal)).rejects.toBeInstanceOf(ControlHeld);
      expect(await session.page.locator('img[loading="lazy"]').count()).toBe(1);
    } finally {
      session.cdp = cdp;
      session.guard.release();
    }
  });
});
