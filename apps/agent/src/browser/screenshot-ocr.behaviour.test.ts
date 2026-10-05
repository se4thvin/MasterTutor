import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { createLocalOcr, sharedLocalOcr, type LocalOcr } from "./local-ocr.ts";
import type { MaskSources } from "./masking.ts";
import { captureModelScreenshot } from "./screenshot.ts";
import type { BandRead } from "./pixel-screen.ts";
import { createScreenCache, type ScreenCache } from "./screen-cache.ts";
import { createSecretFingerprints } from "../vault/fingerprints.ts";
import { ocrContains } from "../vault/testing/ocr.ts";
import type { BrowserSession } from "./session.ts";

const SECRET = "MARMOT4CANARY8VELVET";
const USER = "alice.reader";
let session: BrowserSession;
const reader = createLocalOcr();
const signal = new AbortController().signal;
const vault: MaskSources = {
  nodeIds: () => [],
  hasSecrets: () => true,
  // B3 registers only secret-class values (password, PIN): the username is not among them.
  redact: (text) => text.replaceAll(SECRET, "[secret]"),
};

beforeAll(async () => {
  session = await openTestSession();
  // setContent needs a document without Trusted Types (a fresh slot may start on one).
  await session.goto(`${FIXTURES}/index.html`, signal);
});
afterAll(async () => {
  await session?.close();
  await reader.close();
});

/** A canvas that renders the secret and the username: no DOM text screen can see either. */
async function canvasPage(lines: string[], px = 44, colour = "#000") {
  await session.page.setContent(`<canvas id="c" width="1000" height="300"></canvas>
    <script>
      {
        // A block: setContent keeps the realm, so a second top-level const would not draw.
        const ctx = document.getElementById("c").getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1000, 300);
        ctx.fillStyle = "${colour}"; ctx.font = "${px}px sans-serif";
        ${JSON.stringify(lines)}.forEach((line, i) => ctx.fillText(line, 30, 80 + i * 90));
      }
    </script>`);
}

describe("agent-loop screenshots on a secret-holding run (I-1)", () => {
  it("fills a canvas-drawn secret before the screenshot leaves, and keeps the username", async () => {
    await canvasPage([`Password ${SECRET}`, `Signed in as ${USER}`]);
    const shot = await captureModelScreenshot(session, vault, signal, sharedLocalOcr());
    expect(shot.dropped).toBe(false);
    const seen = await reader.text(shot.png);
    expect(seen).not.toContain("MARMOT");
    expect(seen).toContain(USER);
    expect(seen).toMatch(/Password/);
  }, 120_000);

  it("finds secrets at UI text sizes: 11, 12 and 14 px, grey, and a 14 px descender line (QA-098, review I1)", async () => {
    // The real fingerprints: exact digests plus the confusable-folded ones the pixel screens use.
    const prints = createSecretFingerprints();
    const cdp = await session.cdp();
    const secrets = ["Xk9#mQ2$vL", "Tr0ub4dor&3", "pygmy9Quag"];
    for (const secret of secrets)
      prints.remember("qa-098", {
        filled: { cdp, frameId: "main", loaderId: "doc", backendNodeIds: [] },
        secret,
      });
    const sources = prints.forRun("qa-098");
    const cases = [
      [11, "#000"],
      [12, "#000"],
      [14, "#000"],
      [14, "#808080"],
    ] as const;
    for (const [px, colour] of cases) {
      await canvasPage(
        // The last line is all descenders and ascenders: its words are as tall as the text size.
        [`Password ${secrets[0]}`, `PIN code ${secrets[1]}`, `Typing gypsy ${secrets[2]} jpg`],
        px,
        colour,
      );
      const shot = await captureModelScreenshot(session, sources, signal, sharedLocalOcr());
      // Each secret is filled, or the frame is withheld; never sent readable.
      const large = await sharp(shot.png)
        .resize({ width: shot.width * 2 })
        .png()
        .toBuffer();
      const seen = `${await reader.text(shot.png)}\n${await reader.text(large)}`;
      const label = `${px}px ${colour}: ${seen}`;
      expect(shot.dropped || shot.masked >= 3, label).toBe(true);
      for (const secret of secrets) expect(ocrContains(seen, secret), label).toBe(false);
    }
    prints.forgetRun("qa-098");
  }, 180_000);

  it("catches a large stems-only PIN with the band cache, on first view and scrolled in (review I1)", async () => {
    const prints = createSecretFingerprints();
    prints.remember("big-pin", {
      filled: { cdp: await session.cdp(), frameId: "main", loaderId: "doc", backendNodeIds: [] },
      secret: "1111",
    });
    const sources = prints.forRun("big-pin");
    // A sparse PIN screen: the 96 px "1111" is straight stems for 40+ rows.
    const page = (pinY: number, height: number) =>
      session.page
        .setContent(`<body style="margin:0"><canvas id="c" width="1000" height="${height}"></canvas>
        <script>{
          const ctx = document.getElementById("c").getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1000, ${height});
          ctx.fillStyle = "#000";
          ctx.font = "16px sans-serif"; ctx.fillText("Your account PIN", 40, ${pinY - 180});
          ctx.font = "96px sans-serif"; ctx.fillText("1111", 40, ${pinY});
          ctx.font = "14px sans-serif"; ctx.fillText("Keep it safe.", 40, ${pinY + 300});
        }</script></body>`);
    const fresh = createScreenCache<BandRead>(sources);
    await page(260, 700);
    const first = await captureModelScreenshot(session, sources, signal, sharedLocalOcr(), fresh);
    expect(first.dropped || first.masked > 0, "first view").toBe(true);
    // Out of view at first, then scrolled in as one new band against a warm cache.
    const warm = createScreenCache<BandRead>(sources);
    await page(1500, 2200);
    await captureModelScreenshot(session, sources, signal, sharedLocalOcr(), warm);
    await session.page.evaluate(() => window.scrollTo(0, 1150));
    const scrolled = await captureModelScreenshot(session, sources, signal, sharedLocalOcr(), warm);
    expect(scrolled.dropped || scrolled.masked > 0, "scrolled in").toBe(true);
    prints.forgetRun("big-pin");
  }, 180_000);

  it("never sends the scrollbar strip: the model image is exactly the screened viewport (review I2)", async () => {
    // A page paints its scrollbar: what it shows there is no DOM text and was never screened.
    await session.page.setContent(`<style>
        ::-webkit-scrollbar { width: 25px; height: 25px; background: #ff0000; }
        ::-webkit-scrollbar-thumb { background: #ff0000; }
        body { margin: 0; background: #fff; }
      </style><div style="height: 3000px; font: 16px sans-serif">Long page</div>`);
    const shot = await captureModelScreenshot(session, vault, signal, sharedLocalOcr());
    const { data, info } = await sharp(shot.png).raw().toBuffer({ resolveWithObject: true });
    let red = 0;
    for (let at = 0; at < data.length; at += info.channels)
      if (data[at]! > 200 && data[at + 1]! < 60 && data[at + 2]! < 60) red++;
    expect(red).toBe(0);
    // Model x is CSS x: the image is the CSS viewport, not the capture squeezed into it.
    const layout = await session.layout();
    expect([shot.width, shot.scale]).toEqual([layout.width, 1]);
  }, 120_000);

  it("withholds the screenshot when local OCR fails, and says why", async () => {
    await canvasPage([`Signed in as ${USER}`]);
    const failing: LocalOcr = {
      text: async () => Promise.reject(new Error("tesseract crashed")),
      words: async () => Promise.reject(new Error("tesseract crashed")),
    };
    const shot = await captureModelScreenshot(session, vault, signal, failing);
    expect(shot.dropped).toBe(true);
    expect(shot.withheld).toMatch(/could not be checked for saved secrets/);
  });

  it("does not OCR at all on runs without secrets", async () => {
    await canvasPage([`Signed in as ${USER}`]);
    let read = false;
    const spy: LocalOcr = {
      text: async () => ((read = true), ""),
      words: async () => ((read = true), []),
    };
    const plain = { ...vault, hasSecrets: () => false };
    const shot = await captureModelScreenshot(session, plain, signal, spy);
    expect(shot.dropped).toBe(false);
    expect(read).toBe(false);
  });
  it("measures the p95 latency the screen adds per step (reported, I-1)", async () => {
    await session.goto(`${FIXTURES}/capture/article/index.html`, signal);
    const ocr = sharedLocalOcr();
    await captureModelScreenshot(session, vault, signal, ocr); // warm the worker
    const time = async (sources: MaskSources) => {
      const started = performance.now();
      await captureModelScreenshot(session, sources, signal, ocr);
      return performance.now() - started;
    };
    const plain = { ...vault, hasSecrets: () => false };
    const added: number[] = [];
    for (let i = 0; i < 15; i++) added.push((await time(vault)) - (await time(plain)));
    added.sort((a, b) => a - b);
    const p95 = added[Math.ceil(added.length * 0.95) - 1]!;
    const median = added[Math.floor(added.length / 2)]!;
    process.stderr.write(
      `I-1 screen latency per step: median ${Math.round(median)} ms, p95 ${Math.round(p95)} ms\n`,
    );
    expect(p95).toBeLessThan(10_000);
  }, 300_000);
  it("measures first-view and repeat-step latency with the run's screen cache (reported, QA-098 ruling)", async () => {
    await session.goto(`${FIXTURES}/capture/article/index.html`, signal);
    const prints = createSecretFingerprints();
    prints.remember("latency", {
      filled: { cdp: await session.cdp(), frameId: "main", loaderId: "doc", backendNodeIds: [] },
      secret: SECRET,
    });
    const sources = prints.forRun("latency");
    const plain = { ...sources, hasSecrets: () => false };
    const ocr = sharedLocalOcr();
    await captureModelScreenshot(session, sources, signal, ocr); // warm the worker
    const added = async (cache: ScreenCache<BandRead>) => {
      let started = performance.now();
      await captureModelScreenshot(session, sources, signal, ocr, cache);
      const screened = performance.now() - started;
      started = performance.now();
      await captureModelScreenshot(session, plain, signal, ocr);
      return screened - (performance.now() - started);
    };
    const first: number[] = [];
    const same: number[] = [];
    const scrolled: number[] = [];
    for (let i = 0; i < 9; i++) {
      await session.page.evaluate(() => window.scrollTo(0, 0));
      const cache = createScreenCache<BandRead>(sources);
      first.push(await added(cache));
      same.push(await added(cache)); // a step that changed nothing on screen
      await session.page.evaluate(() => window.scrollBy(0, 160));
      scrolled.push(await added(cache)); // a step that scrolled part of the frame
    }
    const stats = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return `p50 ${Math.round(sorted[Math.floor(sorted.length / 2)]!)} ms, p95 ${Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]!)} ms`;
    };
    process.stderr.write(
      `QA-098 screen added per step: first view ${stats(first)}; unchanged ${stats(same)}; scrolled ${stats(scrolled)}\n`,
    );
    prints.forgetRun("latency");
    expect(Math.max(...same)).toBeLessThan(Math.max(...first));
  }, 600_000);
});
