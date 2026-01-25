import { createLogger } from "@mastertutor/contracts/server";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { SITE, SLOT_CDP } from "../../../../tests/behaviour/constants.ts";
import { ControlHeld } from "../runtime/errors.ts";
import { NO_MASK_SOURCES, type MaskSources } from "./masking.ts";
import { captureModelScreenshot } from "./screenshot.ts";
import { BrowserSession } from "./session.ts";

const log = createLogger({ service: "test", level: "silent" });
const signal = new AbortController().signal;
let session: BrowserSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function open(path: string) {
  session = await BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP["browser-1"] ?? "",
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
  });
  await session.goto(`${SITE}${path}`, signal);
  return session;
}

async function centerIsBlack(
  png: Buffer,
  box: { x: number; y: number; width: number; height: number },
  scale: number,
) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const x = Math.round((box.x + box.width / 2) * scale);
  const y = Math.round((box.y + box.height / 2) * scale);
  const offset = (y * info.width + x) * info.channels;
  return data[offset] === 0 && data[offset + 1] === 0 && data[offset + 2] === 0;
}

describe("model screenshots (spec §9, §12 masking tests)", () => {
  it("is passive: zero DOM mutations and no new style sheets during capture", async () => {
    const s = await open("/masking.html");
    const measure = () =>
      s.page.evaluate(() => ({
        mutations: (window as unknown as { __mutations: string[] }).__mutations.length,
        nodes: document.querySelectorAll("*").length,
        sheets: document.styleSheets.length,
      }));
    const before = await measure();
    await captureModelScreenshot(s, NO_MASK_SOURCES, signal);
    expect(await measure()).toEqual(before);
  });

  it("covers every secret field and leaves plain fields visible", async () => {
    const s = await open("/masking.html");
    const shot = await captureModelScreenshot(s, NO_MASK_SOURCES, signal);
    expect(shot.dropped).toBe(false);
    expect(shot.masked).toBe(9);
    const boxes = await s.page.evaluate(() =>
      ["#password", "#otp", "#pin", ".otp-box", "#plain"].map((selector) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    for (const box of boxes.slice(0, 4))
      expect(await centerIsBlack(shot.png, box, shot.scale)).toBe(true);
    expect(await centerIsBlack(shot.png, boxes[4]!, shot.scale)).toBe(false);
  });

  it("drops the frame when a secret field keeps moving", async () => {
    const s = await open("/masking.html?moving=1");
    const shot = await captureModelScreenshot(s, NO_MASK_SOURCES, signal);
    expect(shot.dropped).toBe(true);
    const stats = await sharp(shot.png).stats();
    expect(stats.channels.every((channel) => channel.max === 0)).toBe(true);
  });

  it("refuses to capture while the user holds control", async () => {
    const s = await open("/masking.html");
    s.guard.hold();
    await expect(captureModelScreenshot(s, NO_MASK_SOURCES, signal)).rejects.toBeInstanceOf(
      ControlHeld,
    );
  });

  it("normalizes to CSS pixels and reports the scale", async () => {
    const s = await open("/interactive.html");
    const layout = await s.layout();
    const shot = await captureModelScreenshot(s, NO_MASK_SOURCES, signal);
    expect(shot.width).toBe(Math.round(layout.width * shot.scale));
    expect(shot.scale).toBeLessThanOrEqual(1);
    expect(s.lastScale).toBe(shot.scale);
  });

  it("masks a password field that was revealed (switched to type=text) by its name hint", async () => {
    const s = await open("/masking-reveal.html");
    await s.page.evaluate(
      () => ((document.getElementById("pw") as HTMLInputElement).type = "text"),
    );
    const shot = await captureModelScreenshot(s, NO_MASK_SOURCES, signal);
    expect(shot.dropped).toBe(false);
    expect(shot.masked).toBe(1);
    const box = await s.page.evaluate(() => {
      const r = document.getElementById("pw")!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    expect(await centerIsBlack(shot.png, box, shot.scale)).toBe(true);
  });

  it("drops the frame when a registered secret value is visible in the page, in any frame", async () => {
    const s = await open("/masking-reveal.html");
    const secrets = (values: string[]): MaskSources => ({
      nodeIds: () => [],
      secretValues: () => values,
    });
    expect((await captureModelScreenshot(s, secrets(["s3cret-memo"]), signal)).dropped).toBe(true);
    expect((await captureModelScreenshot(s, secrets(["inner-secret"]), signal)).dropped).toBe(true);
    expect((await captureModelScreenshot(s, secrets(["not-on-the-page"]), signal)).dropped).toBe(
      false,
    );
  });

  it("masks an element registered by node id", async () => {
    const s = await open("/masking.html");
    const worlds = await s.worlds();
    const objectId = await worlds.evaluateHandle("document.getElementById('plain')");
    const { node } = await (await s.cdp()).send("DOM.describeNode", { objectId: objectId! });
    const registered: MaskSources = { nodeIds: () => [node.backendNodeId], secretValues: () => [] };
    const shot = await captureModelScreenshot(s, registered, signal);
    expect(shot.dropped).toBe(false);
    expect(shot.masked).toBe(10);
    const box = await s.page.evaluate(() => {
      const r = document.getElementById("plain")!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    expect(await centerIsBlack(shot.png, box, shot.scale)).toBe(true);
  });

  it("drops the frame when a cross-origin iframe is present and secrets are registered", async () => {
    const s = await open("/masking-xorigin.html");
    await s.page.waitForSelector("iframe");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await captureModelScreenshot(s, NO_MASK_SOURCES, signal)).dropped).toBe(false);
    const registered: MaskSources = {
      nodeIds: () => [],
      secretValues: () => ["some-secret-value"],
    };
    expect((await captureModelScreenshot(s, registered, signal)).dropped).toBe(true);
  });
});
