import type { Locator, Page } from "@playwright/test";
import { rec, recordedDetail } from "../lib/fixtures/run-recording.ts";
import { emit, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

/**
 * Pip, the mascot (mascot-ui): the state machine wired to the page. Assertions read the slot's
 * data-mascot-state (the machine's output), so they hold for the 2D stand-in and the 3D Pip alike.
 * pip-machine.test.ts covers every transition and timer; this checks the wiring.
 */
test.skip(({ viewport }) => viewport?.width !== 1440, "behaviour checks run once");
// Software-only GL, as on the CI host and for real users without a GPU (D49): Pip must still work.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

const STATE = "data-mascot-state";
const heroPip = (page: Page) => page.locator(`.nt-hero [${STATE}]`);
const runPip = (page: Page) => page.locator(`.run-head [${STATE}]`);

/** Every state the slot shows, in order, from the first paint: no race with short states. */
async function logStates(page: Page): Promise<void> {
  await page.addInitScript((attr) => {
    const log: string[] = [];
    (window as unknown as { __pipLog: string[] }).__pipLog = log;
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        const value = el.getAttribute(attr);
        if (value && log.at(-1) !== value) log.push(value);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: [attr] });
    // A slot server-rendered with its first state never mutates; record it on arrival too.
    new MutationObserver(() => {
      const value = document.querySelector(`[${attr}]`)?.getAttribute(attr);
      if (value && log.length === 0) log.push(value);
    }).observe(document, { subtree: true, childList: true });
  }, STATE);
}
const pipLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pipLog: string[] }).__pipLog);

/** Hydrated, and the arrival wave is over: the form and Pip now react. */
async function arrived(page: Page): Promise<void> {
  await expect.poll(() => pipLog(page), { timeout: 10_000 }).toEqual(["idle", "waving", "idle"]);
}

async function threeLoads(page: Page): Promise<string[]> {
  const hits: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    const body = await response.text().catch(() => "");
    if (body.includes("isWebGLRenderer")) hits.push(response.url());
  });
  return hits;
}

async function expectDecorativeImage(pip: Locator): Promise<void> {
  const img = pip.getByRole("img", { name: "Pip" });
  await expect(img).toBeVisible();
  // Never in the tab order, never focused by a click: keyboard and screen-reader flow unchanged.
  await expect(pip.locator("[tabindex], a, button, input")).toHaveCount(0);
}

test.describe("New task", () => {
  test.beforeEach(async ({ page }) => {
    await logStates(page);
    await page.clock.install();
  });

  test("waves on arrival, then idles; is labelled and never takes focus", async ({ page }) => {
    await page.goto("/new");
    await arrived(page);
    await expectDecorativeImage(heroPip(page));
    await page.getByRole("img", { name: "Pip" }).click();
    // A poke never moves focus into Pip.
    expect(
      await page.evaluate(() => document.activeElement?.closest("[data-mascot-state]") ?? null),
    ).toBeNull();
  });

  test("typing → attentive, a pause → thinking → idle", async ({ page }) => {
    await page.goto("/new");
    await arrived(page);
    const goal = page.getByLabel("Describe the task");
    await goal.click();
    await goal.pressSequentially("Lecture notes");
    await expect(heroPip(page)).toHaveAttribute(STATE, "attentive");
    // The pause after typing, then the thought: the clock is the page's, not the test's.
    await page.clock.runFor(900);
    await expect(heroPip(page)).toHaveAttribute(STATE, "thinking");
    await page.clock.runFor(1_600);
    await expect(heroPip(page)).toHaveAttribute(STATE, "idle");
    expect((await pipLog(page)).slice(-3)).toEqual(["attentive", "thinking", "idle"]);
  });

  test("dozes after a minute without input, and input wakes it", async ({ page }) => {
    await page.goto("/new");
    await arrived(page);
    await page.clock.runFor(61_000);
    await expect(heroPip(page)).toHaveAttribute(STATE, "dozing");
    await page.mouse.move(10, 10);
    await page.clock.runFor(300);
    await expect(heroPip(page)).toHaveAttribute(STATE, "idle");
  });

  test("Start → celebrating, then working, then the run opens", async ({ page }) => {
    // Slow the create a little so the working pose is on screen before the navigation.
    await page.route("**/api/rpc/runs/create", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.fallback();
    });
    await page.goto("/new");
    await arrived(page);
    await page.getByLabel("Describe the task").fill("Find a good intro to Rust lifetimes");
    await page.getByRole("button", { name: /^Start/ }).click();
    await expect(heroPip(page)).toHaveAttribute(STATE, "celebrating");
    await page.clock.runFor(600);
    await expect(heroPip(page)).toHaveAttribute(STATE, "working");
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    expect(await pipLog(page)).toEqual(expect.arrayContaining(["celebrating", "working"]));
  });

  test("a poke gets a wave", async ({ page }) => {
    await page.goto("/new");
    await arrived(page);
    await page.clock.runFor(300);
    await page.getByRole("img", { name: "Pip" }).click();
    await expect(heroPip(page)).toHaveAttribute(STATE, "waving");
    await page.clock.runFor(1_200);
    await expect(heroPip(page)).toHaveAttribute(STATE, "idle");
  });
});

test.describe("never downloads three where the poster must stay (D49)", () => {
  test("software GL", async ({ page }) => {
    const hits = await threeLoads(page);
    await page.goto("/new");
    await expect(page.getByRole("img", { name: "Pip" })).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(hits).toEqual([]);
  });

  test("reduced motion: a still pose, no three", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const hits = await threeLoads(page);
    await page.goto("/new");
    await expect(page.getByRole("img", { name: "Pip" })).toBeVisible();
    const moving = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => (a.effect as KeyframeEffect | null)?.target instanceof SVGElement)
          .filter((a) => a.playState === "running").length,
    );
    expect(moving).toBe(0);
    await page.waitForTimeout(2_000);
    expect(hits).toEqual([]);
  });

  test("Save-Data", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", { value: { saveData: true } });
    });
    const hits = await threeLoads(page);
    await page.goto("/new");
    await expect(page.getByRole("img", { name: "Pip" })).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(hits).toEqual([]);
  });
});

test.describe("run view: Pip mirrors the run status", () => {
  test("running → working; a capture step → reading; needs approval → waiting", async ({
    page,
  }) => {
    await gotoRun(page);
    await expect(runPip(page)).toHaveAttribute(STATE, "working");
    await expectDecorativeImage(runPip(page));
    await emit(page, [
      rec({
        type: "step",
        seq: 40,
        phase: "act",
        state: "started",
        caption: "Capturing the lecture page",
        url: null,
        screenshotKey: null,
        action: { tool: "capture", summary: "Captured the page", point: null },
      }),
    ]);
    await expect(runPip(page)).toHaveAttribute(STATE, "reading");
    await emit(page, [
      rec({ type: "status", status: "waiting", waitReason: "approval", reason: null }),
    ]);
    await expect(runPip(page)).toHaveAttribute(STATE, "waiting");
  });

  test("a sign-in code wait → waiting", async ({ page }) => {
    await gotoRun(page, { detail: recordedDetail({ status: "waiting", waitReason: "otp" }) });
    await expect(runPip(page)).toHaveAttribute(STATE, "waiting");
  });

  test("completes while watched → celebrating, then idle", async ({ page }) => {
    await gotoRun(page);
    await expect(runPip(page)).toHaveAttribute(STATE, "working");
    await emit(page, [
      rec({ type: "status", status: "completed", waitReason: null, reason: null }),
    ]);
    await expect(runPip(page)).toHaveAttribute(STATE, "celebrating");
    await expect(runPip(page)).toHaveAttribute(STATE, "idle", { timeout: 5_000 });
  });

  test("an already completed run opens idle", async ({ page }) => {
    await gotoRun(page, { detail: recordedDetail({ status: "completed", slotName: null }) });
    await expect(runPip(page)).toHaveAttribute(STATE, "idle");
  });

  test("failed → oops", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [
      rec({ type: "status", status: "failed", waitReason: null, reason: "The site is down." }),
    ]);
    await expect(runPip(page)).toHaveAttribute(STATE, "oops");
  });

  test("paused → dozing", async ({ page }) => {
    await gotoRun(page, { detail: recordedDetail({ status: "sleeping", slotName: null }) });
    await expect(runPip(page)).toHaveAttribute(STATE, "dozing");
  });
});

test.describe("empty states", () => {
  test("an empty library: Pip idles; a search with no results: Pip reads", async ({ page }) => {
    await page.route("**/api/rpc/notes/list", (route) =>
      route.fulfill({ json: { json: { items: [], nextCursor: null } } }),
    );
    await page.goto("/library");
    const pip = page.locator(`.empty [${STATE}]`);
    await expect(pip).toHaveAttribute(STATE, "idle");
    await expectDecorativeImage(pip);
    await page.unroute("**/api/rpc/notes/list");
    await page.getByRole("searchbox", { name: "Search the library" }).fill("zzzz-nothing");
    await expect(page.getByRole("heading", { name: "No results" })).toBeVisible();
    await expect(pip).toHaveAttribute(STATE, "reading");
  });
});
