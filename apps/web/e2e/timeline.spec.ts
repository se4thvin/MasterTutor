import type { Page } from "@playwright/test";
import { RECORDED_APPROVAL_ID, rec, recordedEvents } from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, frame, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const steps = (page: Page) => page.getByRole("complementary", { name: "Steps" });
/** FIXTURE_VIEWER.id (lib/server/viewer.ts imports server-only modules, so specs name it). */
const VIEWER_ID = "fixture-user";

test.describe("Timeline", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1440,
    "content checks run once; 390 has its own test",
  );

  test("lists steps with spoken status marks, a vault-fill chip and a summary", async ({
    page,
  }) => {
    await gotoRun(page);
    await expect(steps(page).getByText("5 steps · 2 captures")).toBeVisible();
    await expect(steps(page).getByText("Filled the password for ada-learn")).toBeVisible();
    await expect(steps(page).getByText("Vault fill")).toBeVisible();
    await expect(steps(page).getByRole("img", { name: "Completed" }).first()).toBeVisible();
  });

  test("ThoughtLine thinks during decide, then settles while acting", async ({ page }) => {
    await gotoRun(page);
    const decideStart = recordedEvents()[3]!;
    await emit(page, [decideStart]);
    await expect(
      page.getByRole("status").filter({ hasText: "Deciding whether to start the quiz" }),
    ).toBeAttached();
    // One ThoughtLine speaks it: the page holds exactly one such live region (carry-over).
    await expect(
      page.getByRole("status").filter({ hasText: "Deciding whether to start the quiz" }),
    ).toHaveCount(1);
    await emit(page, [
      rec({
        type: "step",
        seq: 13,
        phase: "act",
        state: "started",
        caption: "Opening the quiz",
        url: null,
        screenshotKey: null,
        action: null,
      }),
    ]);
    await expect(page.getByRole("status").filter({ hasText: /^Thought for/ })).toBeAttached();
  });

  test("budget meters roll to new usage", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [recordedEvents()[2]!]);
    await expect(page.getByTestId("meter-steps").locator(".sr-only")).toHaveText("10");
    await expect(page.getByTestId("meter-spend").locator(".sr-only")).toHaveText("$0.44");
  });

  test("messages send optimistically, dedupe on echo, and restore on failure", async ({ page }) => {
    let fail = false;
    await gotoRun(page, {
      handlers: {
        "runs/sendMessage": () => {
          if (fail) throw new RpcFailure("INTERNAL_SERVER_ERROR", 500);
          return { ok: true };
        },
      },
    });
    const box = page.getByLabel("Message the agent");
    await box.fill("Skip the quiz");
    await box.press("Enter");
    await expect(steps(page).getByText("Skip the quiz")).toHaveCount(1);
    await emit(page, [rec({ type: "user_message", text: "Skip the quiz" })]);
    await expect(steps(page).getByText("Skip the quiz")).toHaveCount(1);
    fail = true;
    await box.fill("Second note");
    await box.press("Enter");
    await expect(page.getByText("Couldn't send your message. It's back in the box.")).toBeVisible();
    await expect(box).toHaveValue("Second note");
  });

  test("decisions name the viewer, another member and superseded approvals (A4, Review Focus 6)", async ({
    page,
  }) => {
    await gotoRun(page);
    await emit(page, [
      ...recordedEvents(),
      rec({
        type: "approval_resolved",
        approvalId: RECORDED_APPROVAL_ID,
        status: "approved",
        decidedBy: VIEWER_ID,
      }),
    ]);
    await expect(steps(page).getByText("You approved: click “Start quiz”")).toBeVisible();
    await emit(page, [
      rec({
        type: "approval_requested",
        approvalId: "00000000-0000-4000-8000-000009000008",
        request: {
          kind: "new_origin",
          origin: "https://docs.example.org",
          url: "https://docs.example.org/x",
        },
      }),
      rec({
        type: "approval_resolved",
        approvalId: "00000000-0000-4000-8000-000009000008",
        status: "superseded",
        decidedBy: "agent",
      }),
    ]);
    await expect(steps(page).getByText("No longer needed: open docs.example.org")).toBeVisible();
  });

  test("replay: a step with a screenshot opens the scrubber, play advances, Jump to live returns", async ({
    page,
  }) => {
    await gotoRun(page);
    await page.getByRole("button", { name: "Replay step: Clicked “Log in”" }).click();
    await expect(frame(page)).toHaveAttribute("data-state", "replay");
    await expect(page.getByRole("slider", { name: "Replay position" })).toHaveValue("2");
    await page.getByRole("button", { name: "Play replay" }).click();
    await expect(page.getByRole("slider", { name: "Replay position" })).toHaveValue("3", {
      timeout: 3_000,
    });
    await frame(page).getByRole("button", { name: "Jump to live" }).click();
    await expect(frame(page)).toHaveAttribute("data-state", "live");
  });
});

test("≤820px: the timeline opens in a sheet from the Steps button", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await gotoRun(page);
  await expect(page.getByRole("complementary", { name: "Steps" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Steps/ }).click();
  const sheet = page.getByRole("dialog", { name: "Steps" });
  await expect(sheet.getByText("Filled the password for ada-learn")).toBeInViewport();
});
