import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { regionIsBlack } from "../testing/png.ts";
import { NO_MASK_SOURCES, type MaskSources } from "./masking.ts";
import { captureMaskedRegion, hasMaskTargets } from "./region-capture.ts";
import type { BrowserSession } from "./session.ts";

let session: BrowserSession;
const signal = new AbortController().signal;
// A run with vault material registered, none of it on this page. // B3 seam
const vault: MaskSources = {
  nodeIds: () => [],
  hasSecrets: () => true,
  redact: (text) => text,
};

beforeAll(async () => {
  session = await openTestSession();
  await session.goto(`${FIXTURES}/capture/region.html`, signal);
});
afterAll(async () => {
  await session?.close();
});

describe("captureMaskedRegion", () => {
  it("captures a document region at scale 2 with secret fields masked on the image", async () => {
    const png = await captureMaskedRegion(
      session,
      NO_MASK_SOURCES,
      { clip: { x: 0, y: 0, width: 400, height: 300 }, scale: 2 },
      signal,
    );
    expect(png).not.toBeNull();
    // The password field sits at (20,240)-(220,270) CSS px, so (40,480)-(440,540) in the image.
    expect(await regionIsBlack(Buffer.from(png!), { x: 44, y: 484, width: 390, height: 50 })).toBe(
      true,
    );
    expect(await regionIsBlack(Buffer.from(png!), { x: 10, y: 10, width: 100, height: 100 })).toBe(
      false,
    );
  });
  it("withholds only regions that overlap a cross-origin frame while vault material is registered", async () => {
    expect(
      await captureMaskedRegion(
        session,
        vault,
        { clip: { x: 0, y: 0, width: 400, height: 200 }, scale: 1 },
        signal,
      ),
    ).not.toBeNull();
    expect(
      await captureMaskedRegion(
        session,
        vault,
        { clip: { x: 550, y: 0, width: 400, height: 200 }, scale: 1 },
        signal,
      ),
    ).toBeNull();
  });
  it("caps the region size", async () => {
    const png = await captureMaskedRegion(
      session,
      NO_MASK_SOURCES,
      { clip: { x: 0, y: 0, width: 10_000, height: 100 }, scale: 1 },
      signal,
    );
    expect(png).not.toBeNull();
  });
});

describe("hasMaskTargets", () => {
  it("sees secret inputs, hidden or not", async () => {
    expect(await hasMaskTargets(session, NO_MASK_SOURCES)).toBe(true);
    await session.page.setContent("<p>plain</p>");
    expect(await hasMaskTargets(session, NO_MASK_SOURCES)).toBe(false);
    await session.page.setContent('<input type="password" hidden value="x">');
    expect(await hasMaskTargets(session, NO_MASK_SOURCES)).toBe(true);
  });
});
