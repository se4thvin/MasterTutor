import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { createLocalOcr, sharedLocalOcr, type LocalOcr } from "./local-ocr.ts";
import type { MaskSources } from "./masking.ts";
import { captureModelScreenshot } from "./screenshot.ts";
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
async function canvasPage(lines: string[], px = 44) {
  await session.page.setContent(`<canvas id="c" width="1000" height="300"></canvas>
    <script>
      const ctx = document.getElementById("c").getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1000, 300);
      ctx.fillStyle = "#000"; ctx.font = "${px}px sans-serif";
      ${JSON.stringify(lines)}.forEach((line, i) => ctx.fillText(line, 30, 80 + i * 90));
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

  it("finds a secret drawn at UI text size, 14 px (QA-098)", async () => {
    // Read at 1× this misreads ("Xke#mQa2svL"); the screen reads a 2× copy.
    const small = "Xk9#mQ2$vL";
    const sources: MaskSources = { ...vault, redact: (text) => text.replaceAll(small, "[secret]") };
    await canvasPage([`Password ${small}`, `Signed in as ${USER}`], 14);
    const shot = await captureModelScreenshot(session, sources, signal, sharedLocalOcr());
    expect(shot.masked > 0 || shot.dropped).toBe(true);
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
});
