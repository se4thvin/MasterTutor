import { readFileSync } from "node:fs";
import { SignedUrl } from "@mastertutor/contracts";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { E2E_SCENARIO } from "../../../../../tests/llm-mock/src/scenarios/e2e.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { frame } from "../../helpers/run.ts";
import { eventsOf, nextBrowserEvent, replayEvents } from "../support/events.ts";
import {
  centrePixel,
  clickLiveCentre,
  isGreen,
  isRed,
  liveVideo,
  videoWidth,
} from "../support/live.ts";
import { rpcOk } from "../support/rpc.ts";
import { createRun, hasStatus, runSteps, waitForRun } from "../support/runs.ts";

/** assets.url is wired by Task 0C once B2/B4/B5 (P3) merges; Task 0C flips this. */
const ASSETS_WIRED = false;
const REPORT = readFileSync(
  new URL("../../../../../tests/fixtures/sites/site/files/report.csv", import.meta.url),
  "utf8",
);

async function holdOn(request: APIRequestContext, page: string): Promise<string> {
  const runId = await createRun(request, {
    goal: scenarioGoal(E2E_SCENARIO.holdPage, `Hold ${SITE}/${page}`),
  });
  await waitForRun(
    request,
    runId,
    (r) => r.status === "running" && (r.currentUrl ?? "").endsWith(`/${page}`),
    `holding ${page}`,
  );
  return runId;
}

async function takeOver(page: Page, request: APIRequestContext, runId: string): Promise<void> {
  await page.goto(`/runs/${runId}`);
  await expect.poll(() => videoWidth(liveVideo(page)), { timeout: 30_000 }).toBe(1280);
  await page.getByRole("button", { name: "Take control of the browser" }).click();
  await expect(frame(page)).toHaveAttribute("data-state", "control", { timeout: 2_000 });
  await expect(page.getByText("Agent paused · screenshots off")).toBeVisible();
  const held = await waitForRun(
    request,
    runId,
    (r) => r.controller === "user",
    "person holds control",
    5_000,
  );
  expect(held.waitReason).toBe("takeover");
}

/** Hands back in the dialog; a held download needs an explicit choice first (B6 A11 Keep/Discard). */
async function handBackInUi(page: Page, held?: "Keep" | "Discard"): Promise<void> {
  await frame(page).getByRole("button", { name: "Hand back" }).click();
  const dialog = page.getByRole("dialog", { name: "Hand back to the agent" });
  if (held) await dialog.getByRole("radio", { name: held }).check();
  await dialog.getByRole("button", { name: "Hand back" }).click();
  await expect(frame(page)).not.toHaveAttribute("data-state", "control", { timeout: 2_000 });
}

async function cancelAndReplay(request: APIRequestContext, runId: string) {
  await rpcOk(request, "runs/cancel", { runId });
  await waitForRun(request, runId, hasStatus("cancelled"), "cancelled");
  return (await replayEvents(request, runId)).records;
}

test.describe("takeover (spec §10.3)", () => {
  test("take over pauses the agent, input reaches the page through n.eko, hand back resumes; a second takeover is a no-op (D10)", async ({
    page,
    request,
  }) => {
    const runId = await holdOn(request, "takeover.html");
    let records;
    try {
      const video = liveVideo(page);
      await page.goto(`/runs/${runId}`);
      await expect.poll(() => videoWidth(video), { timeout: 30_000 }).toBe(1280);
      await expect
        .poll(async () => isRed(await centrePixel(video)), { timeout: 20_000 })
        .toBe(true);
      await takeOver(page, request, runId);

      await rpcOk(request, "runs/takeControl", { runId }); // D10: idempotent for the holder
      const steps = (await runSteps(request, runId)).length;
      await page.waitForTimeout(3_000);
      expect((await runSteps(request, runId)).length).toBe(steps);

      await clickLiveCentre(page);
      await expect
        .poll(async () => isGreen(await centrePixel(video)), { timeout: 10_000 })
        .toBe(true);

      await handBackInUi(page);
      await waitForRun(
        request,
        runId,
        (r) => r.controller === "agent",
        "agent has control again",
        5_000,
      );
      await expect
        .poll(async () => (await runSteps(request, runId)).length, { timeout: 15_000 })
        .toBeGreaterThan(steps);
    } finally {
      records = await cancelAndReplay(request, runId);
    }
    expect(eventsOf(records, "control").filter((event) => event.holder === "user")).toHaveLength(1);
  });

  test("a download the person keeps at hand-back is stored and announced (§3.4)", async ({
    page,
    request,
  }) => {
    const runId = await holdOn(request, "takeover-download.html");
    try {
      await takeOver(page, request, runId);
      const pending = nextBrowserEvent(page, runId, "download_pending", 30_000);
      await clickLiveCentre(page);
      const held = (await pending).event;
      if (held.type !== "download_pending") throw new Error(`unexpected ${held.type}`);
      expect(held.filename).toBe("report.csv");

      const ready = nextBrowserEvent(page, runId, "download_ready", 30_000);
      await rpcOk(request, "runs/handBack", { runId, note: null, keep: [held.downloadId] });
      const stored = (await ready).event;
      if (stored.type !== "download_ready") throw new Error(`unexpected ${stored.type}`);
      expect(stored.downloadId).toBe(held.downloadId);
      // Reading the stored file back needs assets.url (B2, P3).
      if (ASSETS_WIRED) {
        const { url } = SignedUrl.parse(
          await rpcOk(request, "assets/url", { assetId: stored.assetId }),
        );
        expect(await (await request.get(url)).text()).toBe(REPORT);
      }
    } finally {
      await cancelAndReplay(request, runId);
    }
  });

  test("a download the person does not keep is discarded at hand-back (B6 C1)", async ({
    page,
    request,
  }) => {
    const runId = await holdOn(request, "takeover-download.html");
    let records;
    try {
      await takeOver(page, request, runId);
      const pending = nextBrowserEvent(page, runId, "download_pending", 30_000);
      await clickLiveCentre(page);
      await pending;
      await handBackInUi(page, "Discard"); // the dialog sends keep: []
      await waitForRun(
        request,
        runId,
        (r) => r.controller === "agent",
        "agent has control again",
        5_000,
      );
      await page.waitForTimeout(3_000);
    } finally {
      records = await cancelAndReplay(request, runId);
    }
    expect(eventsOf(records, "download_pending")).toHaveLength(1);
    expect(eventsOf(records, "download_ready")).toEqual([]);
  });
});
