import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { imageWidth, regionIsBlack } from "../testing/png.ts";
import { NO_MASK_SOURCES, type MaskSources } from "./masking.ts";
import sharp from "sharp";
import { MAX_REGION_WIDTH, captureMaskedRegion, hasMaskTargets } from "./region-capture.ts";
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
  it("caps the region size (Task 0 review M10)", async () => {
    // The page is 6000 px wide: the region is cut to MAX_REGION_WIDTH, captured viewport by viewport.
    await session.goto(`${FIXTURES}/capture/wide.html`, signal);
    const png = await captureMaskedRegion(
      session,
      NO_MASK_SOURCES,
      { clip: { x: 0, y: 0, width: 10_000, height: 100 }, scale: 1 },
      signal,
    );
    expect(png).not.toBeNull();
    expect(await imageWidth(png!)).toBe(MAX_REGION_WIDTH);
    // And never past the document: the region page is no wider than the viewport.
    await session.goto(`${FIXTURES}/capture/region.html`, signal);
    const narrow = await captureMaskedRegion(
      session,
      NO_MASK_SOURCES,
      { clip: { x: 0, y: 0, width: 10_000, height: 100 }, scale: 1 },
      signal,
    );
    expect(await imageWidth(narrow!)).toBeLessThanOrEqual(1_280);
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

/** The node id of `selector` in the page target, as the vault registers a filled field. */
async function nodeIdOf(selector: string): Promise<number> {
  const cdp = await session.cdp();
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  const { node } = await cdp.send("DOM.describeNode", { nodeId });
  return node.backendNodeId;
}
const clipOf = (x: number, y: number, width: number, height: number, scale = 1) => ({
  clip: { x, y, width, height },
  scale,
});

describe("cross-origin frames anywhere in the page (Task 0 review I1)", () => {
  it("withholds a region over a cross-origin frame inside a shadow root", async () => {
    await session.goto(`${FIXTURES}/capture/shadow-oopif.html`, signal);
    await session.page.waitForTimeout(500);
    expect(await captureMaskedRegion(session, vault, clipOf(550, 0, 400, 200), signal)).toBeNull();
    expect(
      await captureMaskedRegion(session, vault, clipOf(0, 0, 400, 200), signal),
    ).not.toBeNull();
  });

  it("withholds a region over a cross-origin frame nested in a same-origin frame", async () => {
    await session.goto(`${FIXTURES}/capture/nested-frame.html`, signal);
    await session.page.waitForTimeout(500);
    expect(await captureMaskedRegion(session, vault, clipOf(550, 0, 400, 200), signal)).toBeNull();
    expect(
      await captureMaskedRegion(session, vault, clipOf(0, 0, 400, 200), signal),
    ).not.toBeNull();
  });

  it("applies B1's gate: a vault-filled field plus any cross-origin frame withholds every region", async () => {
    await session.goto(`${FIXTURES}/capture/shadow-frame.html`, signal);
    await session.page.waitForTimeout(500);
    const filled = await nodeIdOf("#pw");
    const sources: MaskSources = { ...vault, nodeIds: () => [filled] };
    expect(await captureMaskedRegion(session, sources, clipOf(0, 0, 400, 300), signal)).toBeNull();
  });
});

describe("the captured layout is the measured one (Task 0 review I2)", () => {
  it("masks a field in a region below the fold of a scrolled page", async () => {
    await session.goto(`${FIXTURES}/capture/tall.html`, signal);
    await session.page.evaluate(() => window.scrollTo(0, 1000));
    // The field is at (20,1500)-(220,1530) in the document.
    const png = await captureMaskedRegion(
      session,
      NO_MASK_SOURCES,
      clipOf(0, 1400, 400, 300, 2),
      signal,
    );
    expect(png).not.toBeNull();
    expect(await regionIsBlack(Buffer.from(png!), { x: 44, y: 204, width: 390, height: 50 })).toBe(
      true,
    );
    expect(await regionIsBlack(Buffer.from(png!), { x: 10, y: 10, width: 100, height: 100 })).toBe(
      false,
    );
  });

  it("masks a field in a region taller than the viewport", async () => {
    await session.goto(`${FIXTURES}/capture/tall.html`, signal);
    const png = await captureMaskedRegion(
      session,
      NO_MASK_SOURCES,
      clipOf(0, 0, 400, 2000),
      signal,
    );
    expect(png).not.toBeNull();
    expect(await regionIsBlack(Buffer.from(png!), { x: 22, y: 1502, width: 195, height: 25 })).toBe(
      true,
    );
    expect(
      await regionIsBlack(Buffer.from(png!), { x: 10, y: 1800, width: 100, height: 100 }),
    ).toBe(false);
  });

  it("withholds a region when a secret field is fixed to the viewport (a one-time code bar)", async () => {
    await session.goto(`${FIXTURES}/capture/fixed-secret.html`, signal);
    expect(
      await captureMaskedRegion(session, NO_MASK_SOURCES, clipOf(0, 2800, 400, 200), signal),
    ).toBeNull();
  });
});

/** The RGB of one image pixel. */
async function pixel(png: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

describe("Task 0 re-review (fix 1)", () => {
  it("withholds a region a fixed cross-origin frame scrolls into (N1)", async () => {
    await session.goto(`${FIXTURES}/capture/fixed-frame.html`, signal);
    await session.page.waitForTimeout(500);
    // At scroll 0 the frame is at the top; scrolled to y=2000 it is painted over the clip.
    expect(await captureMaskedRegion(session, vault, clipOf(0, 2000, 400, 300), signal)).toBeNull();
  });

  it("counts a sandboxed frame without allow-same-origin as opaque (N4)", async () => {
    await session.goto(`${FIXTURES}/capture/sandbox-frame.html`, signal);
    await session.page.waitForTimeout(300);
    expect(await captureMaskedRegion(session, vault, clipOf(550, 0, 400, 200), signal)).toBeNull();
    expect(
      await captureMaskedRegion(session, vault, clipOf(0, 0, 400, 200), signal),
    ).not.toBeNull();
  });

  it("captures a below-the-fold region on a page with smooth scrolling (N5)", async () => {
    await session.goto(`${FIXTURES}/capture/smooth.html`, signal);
    const png = await captureMaskedRegion(
      session,
      NO_MASK_SOURCES,
      clipOf(0, 1400, 400, 300),
      signal,
    );
    expect(png).not.toBeNull();
    expect(await regionIsBlack(Buffer.from(png!), { x: 22, y: 102, width: 195, height: 25 })).toBe(
      true,
    );
  });

  it("shows fixed page chrome once, not in every viewport of a tall region (N6)", async () => {
    await session.goto(`${FIXTURES}/capture/fixed-header.html`, signal);
    const { height } = await session.layout();
    const png = await captureMaskedRegion(
      session,
      NO_MASK_SOURCES,
      clipOf(0, 0, 400, 2000),
      signal,
    );
    expect(png).not.toBeNull();
    const red = ([r, g, b]: [number, number, number]) => r > 180 && g < 60 && b < 60;
    expect(red(await pixel(png!, 10, 10))).toBe(true);
    expect(red(await pixel(png!, 10, height + 10))).toBe(false);
  });

  it("restores the page's scroll position when a capture is interrupted (N7)", async () => {
    await session.goto(`${FIXTURES}/capture/tall.html`, signal);
    await session.page.evaluate(() => window.scrollTo(0, 0));
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("stop")), 30);
    await captureMaskedRegion(
      session,
      NO_MASK_SOURCES,
      clipOf(0, 0, 400, 2900),
      controller.signal,
    ).catch(() => null);
    expect(await session.page.evaluate(() => window.scrollY)).toBe(0);
  });

  it("leaves the page where it is once a person has taken over (Task 0 approval note)", async () => {
    await session.goto(`${FIXTURES}/capture/tall.html`, signal);
    await session.page.evaluate(() => window.scrollTo(0, 0));
    // A person takes the browser while the capture is between tiles: the restore must not scroll
    // the page under them.
    const takeover = new Promise<void>((resolve) => {
      const tick = setInterval(async () => {
        if ((await session.page.evaluate(() => window.scrollY)) > 0) {
          clearInterval(tick);
          session.guard.hold();
          resolve();
        }
      }, 5);
    });
    const capture = captureMaskedRegion(session, NO_MASK_SOURCES, clipOf(0, 0, 400, 2900), signal);
    await takeover;
    await expect(capture).rejects.toThrow();
    session.guard.release();
    expect(await session.page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});
