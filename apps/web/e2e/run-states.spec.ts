import {
  OTHER_RUN_ID,
  RECORDED_RUN_ID,
  rec,
  recordedDetail,
  recordedEvents,
} from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, frame, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

test.describe("Run view states", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1440,
    "state checks run once; layout is Tasks 16 and 18",
  );

  test("live: origin pill, secure-fill badge, caption and the live iframe", async ({ page }) => {
    const calls = await gotoRun(page);
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("origin-pill")).toContainText("learn.example.edu");
    await expect(page.getByRole("button", { name: "Filled securely" })).toBeVisible();
    // The caption (the timeline's ThoughtLine says it too, since Task 15).
    await expect(
      page.locator(".run-caption").getByText("Thinking about the next step"),
    ).toBeVisible();
    await expect(page.frameLocator("iframe[title^='Remote browser']").locator("svg")).toBeVisible();
    expect(rpcCalls(calls, "runs/openLive")).toEqual([{ runId: RECORDED_RUN_ID }]);
  });

  test("acting: inner ring and the cursor moves, then pulses on a click", async ({ page }) => {
    await gotoRun(page);
    const [started, done] = recordedEvents();
    await emit(page, [started!]);
    await expect(frame(page)).toHaveAttribute("data-state", "acting");
    await expect(page.getByText("Ticking the Honor Code box").first()).toBeVisible();
    await emit(page, [done!]);
    await expect(page.getByTestId("click-pulse")).toBeAttached();
  });

  test("a computer step without a pointer kind never pulses (W1)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [
      rec({
        type: "step",
        seq: 13,
        phase: "act",
        state: "done",
        caption: "Signing in",
        url: null,
        screenshotKey: null,
        action: { tool: "computer", summary: "Clicked “Go”", point: { x: 100, y: 100 } },
      }),
    ]);
    await expect(page.getByTestId("click-pulse")).toHaveCount(0);
  });

  test("approval: the viewport dims", async ({ page }) => {
    await gotoRun(page);
    await emit(page, recordedEvents());
    await expect(frame(page)).toHaveAttribute("data-state", "approval");
    await expect(page.getByText("Waiting for your approval").first()).toBeVisible();
  });

  test("control: banner reads 'You're in control · Agent paused · screenshots off'", async ({
    page,
  }) => {
    await gotoRun(page, {
      detail: recordedDetail({ controller: "user", status: "waiting", waitReason: "takeover" }),
    });
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect(page.getByText("Agent paused · screenshots off")).toBeVisible();
  });

  test("paused: last masked screenshot, desaturated, with Resume", async ({ page }) => {
    const calls = await gotoRun(page, {
      detail: recordedDetail({ status: "sleeping", slotName: null }),
    });
    await expect(frame(page)).toHaveAttribute("data-state", "paused");
    await expect(frame(page).locator("img[src$='/steps/8/screenshot']")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await page.getByRole("button", { name: "Resume" }).click();
    await expect.poll(() => rpcCalls(calls, "runs/resume").length).toBe(1);
  });

  test("reconnecting: after the grace period, then recovers and re-opens the live view", async ({
    page,
  }) => {
    const calls = await gotoRun(page);
    await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
    await page.evaluate(() => {
      window.__sse.blockOpen = true;
      window.__sse.fail(true);
    });
    await expect(frame(page)).toHaveAttribute("data-state", "reconnecting", { timeout: 5_000 });
    await expect(
      page.getByRole("status").filter({ hasText: "Reconnecting to the browser" }),
    ).toBeVisible();
    await page.evaluate(() => window.__sse.openAll());
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect.poll(() => rpcCalls(calls, "runs/openLive").length).toBe(2);
  });

  test("finished runs show the outcome and offer no takeover", async ({ page }) => {
    await gotoRun(page, { detail: recordedDetail({ status: "completed", slotName: null }) });
    await expect(frame(page)).toHaveAttribute("data-state", "paused");
    await expect(page.getByText("Finished").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Take control of the browser" })).toHaveCount(0);
  });

  test("the live view open in another tab says so and never loops (Review Focus 9)", async ({
    page,
  }) => {
    await page.clock.install();
    const calls = await gotoRun(page, {
      handlers: {
        "runs/openLive": () => {
          throw new RpcFailure("CONFLICT", 409);
        },
      },
    });
    await expect(page.getByText("Open in another tab")).toBeVisible();
    await page.clock.runFor(10_000);
    expect(rpcCalls(calls, "runs/openLive")).toHaveLength(1);
    await expect(frame(page)).not.toHaveAttribute("data-state", "reconnecting");
  });

  test("an unwired live view shows the last screenshot, never Reconnecting (Review Focus 9)", async ({
    page,
  }) => {
    await gotoRun(page, {
      handlers: {
        "runs/openLive": () => {
          throw new RpcFailure("NOT_IMPLEMENTED", 501);
        },
      },
    });
    await expect(page.getByText("Live view unavailable")).toBeVisible();
    await expect(frame(page).locator("img[src$='/steps/8/screenshot']")).toBeVisible();
    await expect(frame(page)).toHaveAttribute("data-state", "live");
  });

  test("a spoofed path never hides the real host (Review Focus 10)", async ({ page }) => {
    await gotoRun(page, {
      detail: recordedDetail({
        currentUrl: "https://evil.example/learn.example.edu/login?\u202Eexe",
      }),
    });
    const pill = page.getByTestId("origin-pill");
    await expect(pill.locator(".run-host")).toHaveText("evil.example");
    expect(await pill.textContent()).not.toContain("\u202E");
  });

  test("an informational error becomes a toast, not the failure (A7)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [rec({ type: "error", code: "download_blocked", message: "cancelled" })]);
    await expect(page.getByText("Take over to download files.").first()).toBeVisible();
    await expect(frame(page)).toHaveAttribute("data-state", "live");
  });

  test("a bypass run carries a persistent badge, in every state (D44)", async ({ page }) => {
    await gotoRun(page, { detail: recordedDetail({ approvalMode: "bypass" }) });
    const badge = page.getByRole("note", { name: "Bypass mode" });
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Approvals are automatic");
    await expect(badge).toContainText("budget limits still pause");
    // The full-screen target (the frame) carries its own indicator (M1).
    await expect(frame(page).getByText("Bypass", { exact: true })).toBeVisible();
    await emit(page, [rec({ type: "control", holder: "user" })]);
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect(badge).toBeVisible();
  });

  test("at md and up, CAPTCHA, stuck and control are each announced by one live region (final I1)", async ({
    page,
  }) => {
    test.skip(page.viewportSize()?.width !== 1440, "announcement check runs once");
    const live = '[aria-live]:not([aria-live="off"]), [role="status"]';
    await gotoRun(page, {
      detail: recordedDetail({ status: "waiting", waitReason: "captcha" }),
    });
    await expect(page.locator(live).filter({ hasText: "solve the CAPTCHA" })).toHaveCount(1);
    await emit(page, [
      rec({ type: "status", status: "waiting", waitReason: "takeover", reason: null }),
    ]);
    await expect(page.locator(live).filter({ hasText: "the agent is stuck" })).toHaveCount(1);
    await emit(page, [rec({ type: "control", holder: "user" })]);
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect(page.locator(live).filter({ hasText: "You're in control" })).toHaveCount(1);
  });

  test("the header cleans the goal (final M11)", async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
    await gotoRun(page, { detail: recordedDetail({ goal: "Evil\u202Egoal\u200B here" }) });
    await expect(page.locator("h1")).toHaveText("Evilgoal here");
  });

  test("an ask run shows no bypass badge", async ({ page }) => {
    await gotoRun(page);
    await expect(page.getByRole("note", { name: "Bypass mode" })).toHaveCount(0);
    await expect(frame(page).getByText("Bypass", { exact: true })).toHaveCount(0);
  });

  test("a stream the server keeps refusing asks runs.get, and a 404 there ends the view (no endless retry)", async ({
    page,
  }) => {
    let gets = 0;
    await gotoRun(page, {
      handlers: {
        "runs/get": () => {
          gets += 1;
          if (gets === 1) return recordedDetail();
          throw new RpcFailure("NOT_FOUND", 404);
        },
      },
    });
    // A refused stream never opens: new sources stay CONNECTING until the server answers.
    await page.evaluate(() => {
      window.__sse.blockOpen = true;
    });
    for (let i = 0; i < 3; i++) {
      await page.waitForFunction((n) => window.__sse.sources.length >= n, i + 1);
      await page.evaluate(() => window.__sse.fail(true));
    }
    await expect(page.getByRole("alert").filter({ hasText: /couldn't be loaded/ })).toBeVisible({
      timeout: 15_000,
    });
    expect(gets).toBe(2);
  });

  test("a refused stream settles on what runs.get says: a run that finished meanwhile stops retrying (M7)", async ({
    page,
  }) => {
    let gets = 0;
    await gotoRun(page, {
      handlers: {
        "runs/get": () => {
          gets += 1;
          return gets === 1
            ? recordedDetail()
            : recordedDetail({ status: "completed", slotName: null });
        },
      },
    });
    await page.evaluate(() => {
      window.__sse.blockOpen = true;
    });
    for (let i = 0; i < 3; i++) {
      await page.waitForFunction((n) => window.__sse.sources.length >= n, i + 1);
      await page.evaluate(() => window.__sse.fail(true));
    }
    await expect(page.getByText("Finished").first()).toBeVisible({ timeout: 15_000 });
    const sources = await page.evaluate(() => window.__sse.sources.length);
    await page.waitForTimeout(3_000);
    expect(await page.evaluate(() => window.__sse.sources.length)).toBe(sources);
  });

  test("moving to another run starts from that run's own snapshot (M6)", async ({ page }) => {
    const other = recordedDetail({ id: OTHER_RUN_ID, lastEventId: "5" });
    await gotoRun(page, {
      handlers: {
        "runs/get": (input) =>
          (input as { runId: string }).runId === OTHER_RUN_ID ? other : recordedDetail(),
        "runs/steps": () => ({ items: [] }),
      },
    });
    await emit(page, recordedEvents());
    // Client-side navigation to the other run (no reload): the runs list link.
    await page.getByRole("link", { name: "Runs" }).first().click();
    await page.locator(`a[href="/runs/${OTHER_RUN_ID}"]`).click();
    await expect(page).toHaveURL(new RegExp(OTHER_RUN_ID));
    await expect
      .poll(() => page.evaluate(() => window.__sse.sources.map((source) => source.url)))
      .toContain(`/api/runs/${OTHER_RUN_ID}/events?after=5`);
    // It never asked the other run's stream for this run's position first.
    const urls = await page.evaluate(() => window.__sse.sources.map((source) => source.url));
    expect(urls.filter((url) => url.includes(OTHER_RUN_ID))).toEqual([
      `/api/runs/${OTHER_RUN_ID}/events?after=5`,
    ]);
  });
});
