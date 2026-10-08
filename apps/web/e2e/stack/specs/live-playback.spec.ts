import { expect, test } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { E2E_SCENARIO } from "../../../../../tests/llm-mock/src/scenarios/e2e.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { liveVideo, videoWidth } from "../support/live.ts";
import { rpcOk } from "../support/rpc.ts";
import { createRun, waitForRun } from "../support/runs.ts";

test("the live view decodes the slot's video with UDP disabled (TCP mux)", async ({
  page,
  request,
}) => {
  const runId = await createRun(request, {
    goal: scenarioGoal(E2E_SCENARIO.holdPage, `Hold ${SITE}/takeover.html`),
  });
  try {
    await waitForRun(
      request,
      runId,
      (r) => r.status === "running" && r.slotName !== null,
      "running on a slot",
    );
    await page.goto(`/runs/${runId}`);
    const video = liveVideo(page);
    await expect.poll(() => videoWidth(video), { timeout: 30_000 }).toBe(1280);
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    await page.waitForTimeout(1_500);
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(before);
  } finally {
    await rpcOk(request, "runs/cancel", { runId });
  }
});
