import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import type { AssetStore } from "../notes/assets.ts";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { fetchInBrowser } from "./fetch-resource.ts";
import { storeMedia } from "./media.ts";
import { pageSanitizeSvg } from "./page/svg.ts";
import { captureWorlds } from "./worlds.ts";

let session: BrowserSession;
const signal = new AbortController().signal;
beforeAll(async () => {
  session = await openTestSession();
});
afterAll(async () => {
  await session?.close();
});

describe("media storage in the slot (Review Focus 1, W2)", () => {
  it("never fetches private hosts, through the page or through CDP", async () => {
    await session.goto(`${FIXTURES}/capture/hostile/index.html`, signal);
    const cdp = await session.cdp();
    const send = vi.spyOn(cdp, "send");
    const worlds = await captureWorlds(session);
    const frameId = await worlds.mainFrameId();
    const stored: string[] = [];
    const assets: AssetStore = {
      put: async (_ws, input) => (
        stored.push(input.mime),
        {
          assetId: crypto.randomUUID(),
          sha256: "x",
          mime: input.mime,
          bytes: 1,
          width: null,
          height: null,
        }
      ),
    };
    const urls = [
      "http://169.254.169.254/latest/meta-data/",
      "http://garage:3900/mastertutor/x.png",
      "http://127.0.0.1:3000/x.png",
    ];
    const report = await storeMedia(
      {
        workspaceId: crypto.randomUUID(),
        assets,
        fetch: (url) => fetchInBrowser({ session, frameId, signal }, url),
        sanitizeSvg: (text) => worlds.call(pageSanitizeSvg, [text]),
        shoot: null,
        signal,
      },
      urls.map((url, index) => ({
        index,
        kind: "img" as const,
        url,
        svg: null,
        dataUrl: null,
        alt: "x",
        rect: { x: 0, y: 0, width: 60, height: 40 },
        selector: null,
        figure: false,
      })),
    );
    expect([...report.stored.values()].every((m) => m.assetId === null)).toBe(true);
    expect(send.mock.calls.filter(([method]) => method === "Network.loadNetworkResource")).toEqual(
      [],
    );
    expect(stored).toEqual([]);
    send.mockRestore();
  });
  it("refuses a public page's redirect to the metadata address: the slot's iptables drop the hop", async () => {
    await session.goto(`${FIXTURES}/capture/hostile/index.html`, signal);
    // The fixture really answers with a 302 there (a manual-redirect fetch sees it without following).
    const probe = await session.page.evaluate(
      async () => (await fetch("/redirect-metadata", { redirect: "manual" })).type,
    );
    expect(probe).toBe("opaqueredirect");
    const frameId = await (await captureWorlds(session)).mainFrameId();
    const cdp = await session.cdp();
    const send = vi.spyOn(cdp, "send");
    // Control: a redirect to an allowed host is followed, so a null below is the private hop's doing.
    expect(
      await fetchInBrowser({ session, frameId, signal }, `${FIXTURES}/redirect-other`),
    ).not.toBeNull();
    const started = Date.now();
    expect(
      await fetchInBrowser({ session, frameId, signal }, `${FIXTURES}/redirect-metadata`),
    ).toBeNull();
    // Rejected at once by the slot, not left to the fetch timeout.
    expect(Date.now() - started).toBeLessThan(10_000);
    // allowsFetch passed both first hops; only the network boundary stopped the second one.
    expect(
      send.mock.calls.filter(([method]) => method === "Network.loadNetworkResource"),
    ).toHaveLength(2);
    send.mockRestore();
  });
});
