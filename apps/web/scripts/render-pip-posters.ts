/**
 * Renders Pip's per-state posters (D49) headless from the live scene, so the fallback is the same
 * model, lighting and pose. Run against a fixture-mode server (`next dev` with WEB_FIXTURE_API=1):
 *   node apps/web/scripts/render-pip-posters.ts http://127.0.0.1:3290
 * Writes components/mascot/posters/pip-<state>-<size>.webp (hero 720 px, compact 128 px).
 */
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { POSTER_PX } from "../components/mascot/posters.ts";
import { PIP_STATES, type PipSize } from "../components/mascot/pip-types.ts";

const base = process.argv[2] ?? "http://127.0.0.1:3290";
const out = new URL("../components/mascot/posters/", import.meta.url);
type Capture = (state: string, size: PipSize, px: number) => string;

const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist"] });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${base}/design/mascot?only=idle&size=compact&pip=live&capture`);
await page.waitForFunction(() => "__pipCapture" in window, null, { timeout: 120_000 });

let bytes = 0;
for (const state of PIP_STATES) {
  for (const size of ["hero", "compact"] as const) {
    const url = await page.evaluate(
      ([s, z, px]) => (window as unknown as { __pipCapture: Capture }).__pipCapture(s, z, px),
      [state, size, POSTER_PX[size]] as const,
    );
    const data = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    writeFileSync(new URL(`pip-${state}-${size}.webp`, out), data);
    bytes += data.length;
    console.log(`pip-${state}-${size}.webp  ${(data.length / 1024).toFixed(1)} kB`);
  }
}
console.log(`total ${(bytes / 1024).toFixed(1)} kB`);
await browser.close();
