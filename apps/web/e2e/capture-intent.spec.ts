import { APPROVAL_MODES, PersonDecider, type CaptureBrief } from "@mastertutor/contracts";
import { recordedDetail, rec } from "../lib/fixtures/run-recording.ts";
import { emit, gotoRun, mockRpc, rpcCalls, RpcFailure } from "./helpers/run.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";
const brief: CaptureBrief = {
  keep: ["reading_text", "definitions"],
  skip: ["due_dates", "scores", "navigation", "platform_chrome"],
  scopeNote: "Lesson text, unchanged.",
};
for (const mode of APPROVAL_MODES) {
  test(`capture scope asks once in ${mode} and preserves the draft on failure`, async ({
    page,
  }, testInfo) => {
    let fail = true;
    const detail = recordedDetail({
      approvalMode: mode,
      status: "waiting",
      waitReason: "approval",
      captureBrief: brief,
      captureQuestion: { question: "What should I keep in your notes?", domains: ["example.edu"] },
    });
    const calls = await gotoRun(page, {
      detail,
      handlers: {
        "runs/setCaptureBrief": () => {
          if (fail) throw new RpcFailure("INTERNAL_SERVER_ERROR", 500);
          detail.captureQuestion = null;
          return { ok: true };
        },
      },
    });
    const card = page.getByRole("region", { name: "Capture scope" });
    await expect(
      card.getByRole("heading", { name: "What should I keep in your notes?" }),
    ).toBeVisible();
    const keep = card.getByRole("group", { name: "Keep" });
    const skip = card.getByRole("group", { name: "Skip" });
    await keep.getByRole("button", { name: "Due dates", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(keep.getByRole("button", { name: "Due dates", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(skip.getByRole("button", { name: "Due dates", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await card.getByLabel("Scope note").fill("Include the due dates for this task.");
    await expectCleanScreen(page);
    await page.screenshot({ path: testInfo.outputPath("scope.png"), fullPage: true });
    await card.getByRole("button", { name: "Continue" }).click();
    await expect(card.getByRole("alert")).toContainText("Couldn't save");
    await expect(card.getByLabel("Scope note")).toHaveValue("Include the due dates for this task.");
    fail = false;
    await card.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => rpcCalls(calls, "runs/setCaptureBrief").length).toBe(2);
    await emit(page, [
      rec({ type: "capture_answered", brief, by: PersonDecider.parse("person-1") }),
    ]);
    await expect(card).toHaveCount(0);
  });
}
test("saved site preferences can be edited in Settings", async ({ page }) => {
  const calls = await mockRpc(page, {
    "settings/capturePreferences": () => ({ items: [{ domain: "example.edu", brief }] }),
    "settings/setCapturePreference": () => ({ ok: true }),
  });
  await page.goto("/settings");
  await page.getByText("example.edu", { exact: true }).click();
  const editor = page.getByRole("region", { name: "Capture preferences for example.edu" });
  await editor.getByLabel("Scope note").fill("Definitions only.");
  await editor.getByRole("button", { name: "Save preferences" }).click();
  await expect.poll(() => rpcCalls(calls, "settings/setCapturePreference").length).toBe(1);
  await expectCleanScreen(page);
});

test("capture brief can be changed from the run thread", async ({ page, viewport }) => {
  const calls = await gotoRun(page, {
    detail: recordedDetail({ captureBrief: brief, captureQuestion: null }),
    handlers: { "runs/setCaptureBrief": () => ({ ok: true }) },
  });
  if ((viewport?.width ?? 1440) <= 420)
    await page.getByRole("button", { name: /Open thread:/ }).click();
  await page.getByText("Capture brief", { exact: true }).click();
  const editor = page.locator("details.capture-scope[open]");
  await editor.getByLabel("Scope note").fill("Definitions and figures only.");
  await editor.getByRole("button", { name: "Save scope" }).click();
  await expect.poll(() => rpcCalls(calls, "runs/setCaptureBrief").length).toBe(1);
  expect(rpcCalls(calls, "runs/setCaptureBrief")[0]).toMatchObject({
    brief: { scopeNote: "Definitions and figures only." },
  });
  await expectCleanScreen(page);
});
