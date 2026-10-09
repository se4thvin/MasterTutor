import { createLogger } from "@mastertutor/contracts/server";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { SITE, SLOT_CDP } from "../../../../tests/behaviour/constants.ts";
import { ControlHeld } from "../runtime/errors.ts";
import { NO_MASK_SOURCES, SECRET_REDACTION, type MaskSources } from "./masking.ts";
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

  const secrets = (values: string[]): MaskSources => ({
    nodeIds: () => [],
    hasSecrets: () => values.length > 0,
    redact: (text) => values.reduce((out, value) => out.split(value).join(SECRET_REDACTION), text),
  });

  it("drops the frame when a registered secret value is visible in the page, in any frame", async () => {
    const s = await open("/masking-reveal.html");
    expect((await captureModelScreenshot(s, secrets(["s3cret-memo"]), signal)).dropped).toBe(true);
    expect((await captureModelScreenshot(s, secrets(["inner-secret"]), signal)).dropped).toBe(true);
    expect((await captureModelScreenshot(s, secrets(["not-on-the-page"]), signal)).dropped).toBe(
      false,
    );
  });

  async function plainNode(s: BrowserSession): Promise<number> {
    const worlds = await s.worlds();
    const objectId = await worlds.evaluateHandle("document.getElementById('plain')");
    const { node } = await (await s.cdp()).send("DOM.describeNode", { objectId: objectId! });
    return node.backendNodeId;
  }

  it("masks an element registered by node id", async () => {
    const s = await open("/masking.html");
    const id = await plainNode(s);
    const registered: MaskSources = { ...secrets([]), nodeIds: () => [id] };
    const shot = await captureModelScreenshot(s, registered, signal);
    expect(shot.dropped).toBe(false);
    expect(shot.masked).toBe(10);
    const box = await s.page.evaluate(() => {
      const r = document.getElementById("plain")!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    expect(await centerIsBlack(shot.png, box, shot.scale)).toBe(true);
  });

  it("stays sighted after the filled page navigates: the node's document is gone (F8)", async () => {
    const s = await open("/masking.html");
    const id = await plainNode(s);
    const registered: MaskSources = { ...secrets([]), nodeIds: () => [id] };
    await s.goto(`${SITE}/page2.html`, signal);
    expect((await captureModelScreenshot(s, registered, signal)).dropped).toBe(false);
  });

  it("drops for a cross-origin iframe only while filled nodes are registered (R-E5)", async () => {
    const s = await open("/masking-xorigin.html");
    await s.page.waitForSelector("iframe");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await captureModelScreenshot(s, NO_MASK_SOURCES, signal)).dropped).toBe(false);
    expect((await captureModelScreenshot(s, secrets(["some-secret-value"]), signal)).dropped).toBe(
      false,
    );
    const id = await plainNode(s);
    const filled: MaskSources = { ...secrets([]), nodeIds: () => [id] };
    expect((await captureModelScreenshot(s, filled, signal)).dropped).toBe(true);
  });

  it.each(["removes", "hides"] as const)(
    "a secret-holding run stays sighted after an in-page sign-in %s the filled field (R-E5, no navigation)",
    async (how) => {
      // A single-page app signs in without a navigation: the filled node stays registered for the
      // document, but nothing secret is on screen, so the model must get the real page.
      const s = await open("/masking-xorigin.html");
      await s.page.waitForSelector("iframe");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const id = await plainNode(s);
      const filled: MaskSources = { ...secrets(["zz-vault-pass-77"]), nodeIds: () => [id] };
      await s.page.evaluate((mode) => {
        const field = document.getElementById("plain")!;
        if (mode === "removes") field.remove();
        else field.style.display = "none";
      }, how);
      const shot = await captureModelScreenshot(s, filled, signal);
      expect(shot.withheld).toBeNull();
      expect(shot.dropped).toBe(false);
      const { channels } = await sharp(shot.png).stats();
      expect(channels.some((channel) => channel.max > 0)).toBe(true);
    },
  );

  async function openOopif(): Promise<BrowserSession> {
    const s = await open("/masking-oopif.html");
    await expect
      .poll(() => s.page.frames().some((frame) => frame.url().endsWith("/echo.html")))
      .toBe(true);
    const frame = s.page.frames().find((candidate) => candidate.url().endsWith("/echo.html"))!;
    await frame.waitForSelector("#echo");
    return s;
  }

  it("reads an out-of-process frame's tree: delivered when clean, dropped when it echoes a secret (R-E5)", async () => {
    const s = await openOopif();
    expect((await captureModelScreenshot(s, secrets(["absent-value-9"]), signal)).dropped).toBe(
      false,
    );
    expect((await captureModelScreenshot(s, secrets(["oopif-secret-42"]), signal)).dropped).toBe(
      true,
    );
  });

  it("an unrelated cross-site frame does not drop a page with filled fields, which stay masked (I1)", async () => {
    const s = await openOopif();
    const id = await plainNode(s);
    const pageCdp = await s.cdp();
    const filled: MaskSources = { ...secrets([]), nodeIds: (cdp) => (cdp === pageCdp ? [id] : []) };
    const shot = await captureModelScreenshot(s, filled, signal);
    expect(shot.dropped).toBe(false);
    expect(shot.masked).toBe(1);
    const box = await s.page.evaluate(() => {
      const r = document.getElementById("plain")!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    expect(await centerIsBlack(shot.png, box, shot.scale)).toBe(true);
  });

  it("drops the page when the vault filled a field inside the out-of-process frame (I1)", async () => {
    const s = await openOopif();
    const [inFrame] = [...(await s.outOfProcessFrames()).values()];
    const own = inFrame!.cdp;
    await own.send("DOM.enable");
    const { root } = await own.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await own.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#echo",
    });
    const { node } = await own.send("DOM.describeNode", { nodeId });
    const filled: MaskSources = {
      ...secrets([]),
      nodeIds: (cdp) => (cdp === own ? [node.backendNodeId] : []),
    };
    expect((await captureModelScreenshot(s, filled, signal)).dropped).toBe(true);
  });
});
