import type { Page, TestInfo } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { PIP_STATES } from "../components/mascot/pip-types.ts";
import { expect, test } from "./helpers/test.ts";

// The CI host has no GPU: WebGL is SwiftShader, which Pip's gate treats as software (D49).
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

/** Script responses that contain three (WebGLRenderer). */
function threeLoads(page: Page): string[] {
  const hits: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    const body = await response.text().catch(() => "");
    if (body.includes("isWebGLRenderer")) hits.push(response.url());
  });
  return hits;
}

/** Page errors and console errors, collected for the whole test. */
function errors(page: Page): string[] {
  const found: string[] = [];
  page.on("pageerror", (e) => found.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") found.push(m.text());
  });
  return found;
}

const card = (page: Page, state: string) =>
  page.locator(`[data-qa="pip-card"][data-state="${state}"]`);

/** True when the Pip's canvas holds a drawn frame (some opaque pixels). */
const drawn = (page: Page, selector: string) =>
  page.locator(selector).evaluate((host) => {
    const canvas = host.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || canvas.width === 0) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 200) opaque++;
    return opaque > (canvas.width * canvas.height) / 20;
  });

type Stats = {
  frames: number;
  tickMs: number[];
  updateMs: number[];
  frameGapMs: number[];
  triangles: number;
  meshes: number;
};
const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pipStats?: Stats }).__pipStats ?? null);

test.describe("Pip gallery (runs once, at 1440)", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "gallery checks run once");

  test("software GL shows every state's poster at both sizes and never downloads three (D49)", async ({
    page,
  }) => {
    const hits = threeLoads(page);
    const problems = errors(page);
    await page.goto("/design/mascot");
    await expect(page.locator('[data-qa="pip-card"]')).toHaveCount(PIP_STATES.length);
    for (const state of PIP_STATES) {
      const pips = card(page, state).locator(".pip");
      await expect(pips).toHaveCount(2);
      await pips.first().scrollIntoViewIfNeeded();
      for (const pip of await pips.all()) {
        await expect(pip).toHaveAttribute("data-state", state);
        await expect(pip).not.toHaveAttribute("data-live", "");
        const poster = pip.locator("img.pip-poster");
        await expect
          .poll(() => poster.evaluate((img: HTMLImageElement) => img.naturalWidth))
          .toBeGreaterThan(0);
      }
    }
    await expect(card(page, "idle").getByRole("button", { name: "Pip, idle" })).toBeVisible();
    await expect(card(page, "idle").getByRole("img", { name: "Pip, idle, compact" })).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(hits).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("reduced motion keeps the still poster and never downloads three", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const hits = threeLoads(page);
    await page.goto("/design/mascot?only=waving&pip=live");
    await page.waitForTimeout(2_500);
    await expect(page.locator(".pip")).not.toHaveAttribute("data-live", "");
    expect(hits).toEqual([]);
  });

  test("?pip=live renders every state live at both sizes without errors", async ({ page }) => {
    test.setTimeout(180_000);
    const hits = threeLoads(page);
    const problems = errors(page);
    await page.goto("/design/mascot?pip=live");
    for (const state of PIP_STATES) {
      const target = card(page, state);
      await target.scrollIntoViewIfNeeded();
      for (const pip of await target.locator(".pip").all()) {
        await expect(pip).toHaveAttribute("data-live", "", { timeout: 30_000 });
      }
      expect(
        await drawn(page, `[data-qa="pip-card"][data-state="${state}"] .pip[data-size="hero"]`),
        state,
      ).toBe(true);
      expect(
        await drawn(page, `[data-qa="pip-card"][data-state="${state}"] .pip[data-size="compact"]`),
        state,
      ).toBe(true);
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("blends between states and wears accessories without errors", async ({ page }) => {
    const problems = errors(page);
    await page.goto("/design/mascot?only=idle&pip=live");
    const pip = page.locator(".pip");
    await expect(pip).toHaveAttribute("data-live", "", { timeout: 30_000 });
    for (const state of ["Celebrating", "Working", "Reading", "Dozing", "Oops"]) {
      await page.getByRole("button", { name: state, exact: true }).click();
      await expect(pip).toHaveAttribute("data-state", state.toLowerCase());
      await page.waitForTimeout(400);
      await expect(pip).toHaveAttribute("data-live", "");
    }
    expect(problems).toEqual([]);
  });

  test("a poke reacts and calls onPoke", async ({ page }) => {
    await page.goto("/design/mascot?pip=live");
    const pip = card(page, "idle").getByRole("button", { name: "Pip, idle" });
    await expect(pip).toHaveAttribute("data-live", "", { timeout: 30_000 });
    await pip.click();
    await expect(page.getByText("Poked 1×.")).toBeVisible();
  });

  test("offscreen Pips stop drawing and show their poster", async ({ page }) => {
    await page.goto("/design/mascot?pip=live");
    const idle = card(page, "idle").locator(".pip").first();
    await expect(idle).toHaveAttribute("data-live", "", { timeout: 30_000 });
    // The shell scrolls #main, not the window.
    await page.locator("#main").evaluate((main) => main.scrollTo({ top: main.scrollHeight }));
    await expect(idle).not.toHaveAttribute("data-live", "");
  });

  test("a hidden tab does no GPU work", async ({ page }) => {
    await page.goto("/design/mascot?only=celebrating&pip=live&debug");
    await expect(page.locator(".pip")).toHaveAttribute("data-live", "", { timeout: 30_000 });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(300);
    const a = (await stats(page))!.frames;
    await page.waitForTimeout(1_000);
    expect((await stats(page))!.frames - a).toBeLessThanOrEqual(1);
  });
});

/**
 * Frame cost on this host (no GPU: SwiftShader, so every frame is rasterised on the CPU). The
 * numbers go to the report. The asserted budget is Pip's own motion work per frame; the full tick
 * (which on SwiftShader includes the synchronous copy, i.e. the whole render) is recorded.
 */
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
};

async function measure(page: Page, info: TestInfo, size: "hero" | "compact") {
  await page.goto(`/design/mascot?only=working&size=${size}&pip=live&debug`);
  await expect(page.locator(".pip")).toHaveAttribute("data-live", "", { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await page.evaluate(() => {
    const s = (window as unknown as { __pipStats: Stats }).__pipStats;
    s.tickMs.length = 0;
    s.updateMs.length = 0;
    s.frameGapMs.length = 0;
  });
  await page.waitForTimeout(5_000);
  const s = (await stats(page))!;
  const result = {
    size,
    samples: s.tickMs.length,
    fps: s.tickMs.length / 5,
    updateP50: percentile(s.updateMs, 50),
    updateP95: percentile(s.updateMs, 95),
    tickP50: percentile(s.tickMs, 50),
    tickP95: percentile(s.tickMs, 95),
    frameGapP50: percentile(s.frameGapMs, 50),
    frameGapP95: percentile(s.frameGapMs, 95),
    triangles: s.triangles,
    meshes: s.meshes,
  };
  info.annotations.push({ type: "pip-frame", description: JSON.stringify(result) });
  writeFileSync(info.outputPath(`pip-frames-${size}.json`), JSON.stringify(result, null, 2));
  return result;
}

test.describe("Pip frame budget (runs once, at 1440)", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "perf runs once");

  for (const size of ["hero", "compact"] as const) {
    test(`${size}: p50/p95 frame cost`, async ({ page }, info) => {
      const r = await measure(page, info, size);
      expect(r.samples).toBeGreaterThan(30);
      // Pip's own per-frame CPU work stays a small slice of the D28 frame (16.7 ms) even here.
      // The full tick and the frame gaps are reported, not asserted: on this host they measure
      // SwiftShader rasterising on a shared CPU, which D49 never shows users (they get posters).
      expect(r.updateP95).toBeLessThan(4);
    });
  }
});
