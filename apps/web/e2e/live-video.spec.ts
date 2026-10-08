import type { Page } from "@playwright/test";
import { recordedDetail } from "../lib/fixtures/run-recording.ts";
import { LATE_VIDEO_MS, frame, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

// I1: n.eko's ICE-TCP path can accept the browser's connection and never answer it, so a WebRTC
// session sometimes decodes no video. The live view says so after NO_VIDEO_MS, over the last
// screenshot, and offers Retry; it never spins forever, never retries on its own and never touches
// the run's control (coordinator ruling).
test.skip(({ viewport }) => viewport?.width !== 1440, "behaviour checks run once");

const iframe = (page: Page) => page.locator("iframe[title^='Remote browser']");
const unavailable = (page: Page) =>
  page.getByRole("status").filter({ hasText: "Live view unavailable" });

test("a session that decodes no video says so and stops there: no endless wait or retry", async ({
  page,
}) => {
  let loads = 0;
  const calls = await gotoRun(page, { liveEmbed: () => (++loads, "blank") });
  await expect(unavailable(page)).toBeVisible({ timeout: 10_000 });
  await expect(unavailable(page).getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(frame(page).locator(".run-viewport")).toHaveAttribute("data-shot", "true");
  await page.waitForTimeout(7_000);
  expect(loads).toBe(1);
  expect(rpcCalls(calls, "runs/openLive")).toHaveLength(1);
});

test("the notice clears when a late first frame arrives", async ({ page }) => {
  await gotoRun(page, { liveEmbed: () => "late" });
  await expect(unavailable(page)).toBeVisible({ timeout: 10_000 });
  await expect(unavailable(page)).toHaveCount(0, { timeout: LATE_VIDEO_MS });
  await expect(frame(page).locator(".run-viewport")).not.toHaveAttribute("data-shot");
});

test("Retry opens a fresh session, and the notice clears once it plays", async ({ page }) => {
  let loads = 0;
  const calls = await gotoRun(page, { liveEmbed: () => (++loads === 1 ? "blank" : "video") });
  await unavailable(page).getByRole("button", { name: "Retry" }).click({ timeout: 10_000 });
  await expect.poll(() => loads).toBe(2);
  expect(rpcCalls(calls, "runs/openLive")).toHaveLength(2);
  await page.waitForTimeout(7_000);
  await expect(unavailable(page)).toHaveCount(0);
  await expect(frame(page).locator(".run-viewport")).not.toHaveAttribute("data-shot");
});

test("any new load of the embed is watched, not only the first", async ({ page }) => {
  let loads = 0;
  await gotoRun(page, { liveEmbed: () => (++loads === 2 ? "blank" : "video") });
  await expect.poll(() => loads).toBe(1);
  await page.waitForTimeout(1_000);
  // The embed reloads itself (as n.eko's client does when its websocket reconnects) into a session
  // that decodes nothing.
  await iframe(page).evaluate((frame: HTMLIFrameElement) => frame.contentWindow?.location.reload());
  await expect.poll(() => loads).toBe(2);
  await expect(unavailable(page)).toBeVisible({ timeout: 10_000 });
});

test("while the person holds control the notice leaves control alone", async ({ page }) => {
  const calls = await gotoRun(page, {
    detail: recordedDetail({ controller: "user", status: "waiting", waitReason: "takeover" }),
    liveEmbed: () => "blank",
  });
  await expect(frame(page)).toHaveAttribute("data-state", "control");
  await expect(unavailable(page)).toBeVisible({ timeout: 10_000 });
  await expect(frame(page)).toHaveAttribute("data-state", "control");
  expect(rpcCalls(calls, "runs/takeControl")).toEqual([]);
  expect(rpcCalls(calls, "runs/handBack")).toEqual([]);
});
