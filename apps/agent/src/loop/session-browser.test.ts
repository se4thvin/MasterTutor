import { describe, expect, it } from "vitest";
import { TINY_PNG } from "../testing/fake-loop-browser.ts";
import { perceptualDistance } from "../browser/phash.ts";
import type { Observation } from "./loop-browser.ts";
import { observeOnOnePage } from "./session-browser.ts";

const capture = (url: string, png = TINY_PNG): Observation => ({
  url,
  title: `Title of ${url}`,
  origin: new URL(url).origin,
  domHash: `hash-${url}`,
  screenshot: { png, width: 1, height: 1, scale: 1, masked: 0, dropped: false, withheld: null },
  phash: [7],
  captcha: false,
  signIn: false,
  scroll: { x: 0, y: 0 },
  videoTime: null,
});

/** A page whose URL changes once per read, `stableAfter` reads in. */
function page(urls: string[]) {
  let reads = 0;
  const captured: string[] = [];
  return {
    captured,
    readUrl: () => urls[Math.min(reads++, urls.length - 1)]!,
    capture: async (url: string) => {
      captured.push(url);
      return capture(url, Buffer.from(`page ${url}`));
    },
  };
}

describe("observeOnOnePage (review M7)", () => {
  it("pairs the screenshot with the URL it was captured on", async () => {
    const fake = page(["http://a.test/1", "http://a.test/1"]);
    const obs = await observeOnOnePage(fake.readUrl, fake.capture);
    expect(obs.url).toBe("http://a.test/1");
    expect(obs.screenshot.dropped).toBe(false);
    expect(fake.captured).toEqual(["http://a.test/1"]);
  });

  it("retakes the observation on the new page after a navigation", async () => {
    const fake = page(["http://a.test/1", "http://a.test/2", "http://a.test/2"]);
    const obs = await observeOnOnePage(fake.readUrl, fake.capture);
    expect(fake.captured).toEqual(["http://a.test/1", "http://a.test/2"]);
    expect(obs.url).toBe("http://a.test/2");
    expect(obs.screenshot.png.toString()).toBe("page http://a.test/2");
  });

  it("withholds the screenshot when the URL still changes on the third attempt", async () => {
    const urls = ["http://a.test/1", "http://a.test/2", "http://a.test/3", "http://b.test/4"];
    const fake = page(urls);
    const obs = await observeOnOnePage(fake.readUrl, fake.capture);
    expect(fake.captured).toEqual(urls.slice(0, 3));
    // Never one page's screenshot, DOM hash or title under another page's URL.
    expect(obs.url).toBe("http://b.test/4");
    expect(obs.origin).toBe("http://b.test");
    expect(obs.screenshot.dropped).toBe(true);
    expect(obs.screenshot.png.toString()).not.toContain("page");
    expect(obs.domHash).toBe("");
    expect(obs.title).toBe("");
  });

  it("gives every withheld frame its own perceptual hash, so loop detection never matches them (M8)", async () => {
    const urls = ["http://a.test/1", "http://a.test/2", "http://a.test/3", "http://a.test/4"];
    const a = page(urls);
    const b = page(urls);
    const first = await observeOnOnePage(a.readUrl, a.capture);
    const second = await observeOnOnePage(b.readUrl, b.capture);
    expect(first.screenshot.dropped && second.screenshot.dropped).toBe(true);
    expect(perceptualDistance(first.phash, second.phash)).toBe(Number.POSITIVE_INFINITY);
  });
});
