import { randomUUID } from "node:crypto";
import { runEventsPath, stepScreenshotPath } from "@mastertutor/contracts";
import { SIGNED_OUT } from "../support/env.ts";
import { expect, test } from "@playwright/test";
import { frame } from "../../helpers/run.ts";
import { expectCleanScreen } from "../../helpers/test.ts";
import { replayEvents } from "../support/events.ts";
import { finishedRun, runSteps } from "../support/runs.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("the stream refuses anonymous readers, hides unknown runs, and clamps or refuses an id above 2^63-1", async ({
  request,
  playwright,
  baseURL,
}) => {
  const run = await finishedRun(request);
  const anonymous = await playwright.request.newContext({ baseURL, ...SIGNED_OUT });
  expect((await anonymous.get(runEventsPath(run.id))).status()).toBe(401);
  await anonymous.dispose();
  expect((await replayEvents(request, randomUUID())).status).toBe(404);
  const over = await replayEvents(request, run.id, { after: "9999999999999999999" });
  expect([200, 400]).toContain(over.status);
  expect(over.records).toEqual([]);
});

test("step screenshots are PNGs served by seq, to members only (D6)", async ({
  request,
  playwright,
  baseURL,
}) => {
  const run = await finishedRun(request);
  const shots = (await runSteps(request, run.id)).filter(
    (step) => step.phase === "observe" && step.screenshotKey !== null,
  );
  expect(shots.length).toBeGreaterThan(0);
  const seq = shots.at(-1)!.seq;
  const shot = await request.get(stepScreenshotPath(run.id, seq));
  expect(shot.status()).toBe(200);
  expect(shot.headers()["content-type"]).toBe("image/png");
  expect((await shot.body()).subarray(0, 8).equals(PNG)).toBe(true);
  const missing = await request.get(stepScreenshotPath(run.id, 999_999), {
    failOnStatusCode: false,
  });
  expect(missing.status()).toBe(404);
  const anonymous = await playwright.request.newContext({ baseURL, ...SIGNED_OUT });
  expect((await anonymous.get(stepScreenshotPath(run.id, seq))).status()).toBe(401);
  await anonymous.dispose();
});

test("a finished run's view with real data passes layout QA and axe in light and dark (P1 helpers)", async ({
  page,
  request,
}) => {
  const run = await finishedRun(request);
  await page.goto(`/runs/${run.id}`);
  await expect(frame(page)).toHaveAttribute("data-state", "paused");
  await expect(frame(page).locator("img[src*='/steps/']")).toBeVisible();
  await expectCleanScreen(page);
});
