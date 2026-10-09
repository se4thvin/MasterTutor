import type { Page } from "@playwright/test";
import { rec, recordedDetail } from "../lib/fixtures/run-recording.ts";
import { findLayoutIssues } from "./helpers/layout-qa.ts";
import { RpcFailure, emit, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, expectCleanScreen, isPhone, test } from "./helpers/test.ts";

/** FIXTURE_VIEWER.id (lib/server/viewer.ts imports server-only modules, so specs name it). */
const VIEWER_ID = "fixture-user";
const modeButton = (page: Page) => page.getByRole("button", { name: /^Approvals: / });
const thread = (page: Page) => page.getByRole("complementary", { name: "Thread" });
const choose = async (page: Page, label: string) => {
  await modeButton(page).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${label}`) }).click();
};

test.describe("run-mode: change the approval mode mid-run", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "content checks run once");

  test("switches from the toolbar; the thread says who switched and when", async ({ page }) => {
    const calls = await gotoRun(page);
    await expect(modeButton(page)).toHaveAccessibleName("Approvals: Ask me");
    await choose(page, "Auto in allowed domains");
    await expect(modeButton(page)).toHaveAccessibleName("Approvals: Auto in allowed domains");
    expect(rpcCalls(calls, "runs/setApprovalMode")).toEqual([
      { runId: recordedDetail().id, mode: "auto_within_allowlist" },
    ]);
    const change = rec({
      type: "approval_mode_changed",
      from: "ask",
      to: "auto_within_allowlist",
      by: VIEWER_ID,
    });
    await emit(page, [change]);
    const time = new Date(change.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const line = thread(page).locator(".th-item[data-kind='mode']");
    await expect(line).toContainText("You switched to Auto");
    await expect(line.locator("time")).toHaveText(time);
  });

  test("Bypass shows New task's warning and needs the acknowledgement; then the badge stays", async ({
    page,
  }) => {
    const calls = await gotoRun(page);
    await choose(page, "Bypass approvals");
    const sheet = page.getByRole("dialog", { name: "Switch this run to Bypass?" });
    await expect(sheet.getByTestId("bypass-warning")).toContainText(
      "prompt-injection warnings still stop for you",
    );
    const confirm = sheet.getByRole("button", { name: "Switch to Bypass" });
    await expect(confirm).toBeDisabled();
    // Keeping the mode changes nothing.
    await sheet.getByRole("button", { name: "Keep Ask" }).click();
    await expect(sheet).toBeHidden();
    expect(rpcCalls(calls, "runs/setApprovalMode")).toEqual([]);
    await choose(page, "Bypass approvals");
    // The acknowledgement is fresh each time.
    await expect(confirm).toBeDisabled();
    await sheet.getByLabel("I understand. Switch this run to bypass mode.").check();
    await confirm.click();
    expect(rpcCalls(calls, "runs/setApprovalMode")).toEqual([
      { runId: recordedDetail().id, mode: "bypass", bypassAcknowledged: true },
    ]);
    await expect(page.getByRole("note", { name: "Bypass mode" })).toBeVisible();
    await emit(page, [
      rec({ type: "approval_mode_changed", from: "ask", to: "bypass", by: VIEWER_ID }),
    ]);
    await expect(thread(page).getByText("You switched to Bypass")).toBeVisible();
    await expect(page.getByRole("note", { name: "Bypass mode" })).toBeVisible();
  });

  test("works from the keyboard", async ({ page }) => {
    const calls = await gotoRun(page);
    await modeButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitemradio", { name: /^Ask me/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect(rpcCalls(calls, "runs/setApprovalMode")).toEqual([
      { runId: recordedDetail().id, mode: "auto_within_allowlist" },
    ]);
  });

  test("a refused change rolls back and says why", async ({ page }) => {
    await gotoRun(page, {
      handlers: {
        "runs/setApprovalMode": () => {
          throw new RpcFailure("BAD_REQUEST", 400);
        },
      },
    });
    await choose(page, "Auto in allowed domains");
    await expect(
      page.getByText("Auto needs at least one allowed domain on this run."),
    ).toBeVisible();
    await expect(modeButton(page)).toHaveAccessibleName("Approvals: Ask me");
  });

  test("is disabled once the run has finished", async ({ page }) => {
    await gotoRun(page, { detail: recordedDetail({ status: "completed" }) });
    await expect(modeButton(page)).toBeDisabled();
  });
});

test.describe("run-mode: Send queues, Send now interrupts", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "content checks run once");

  test("Enter queues, ⌘/Ctrl+Enter and the split button's menu send now; the hint names both", async ({
    page,
  }) => {
    const calls = await gotoRun(page);
    const box = thread(page).getByLabel("Message the agent");
    await expect(
      thread(page).getByText("↵ Send after this step · ⌘↵ Send now, interrupting"),
    ).toBeVisible();
    await box.fill("Then reading 3");
    await box.press("Enter");
    await box.fill("Stop, wrong page");
    await box.press("ControlOrMeta+Enter");
    await box.fill("Go back");
    await thread(page).getByRole("button", { name: "More ways to send" }).click();
    await page.getByRole("menuitem", { name: /^Send now/ }).click();
    const runId = recordedDetail().id;
    expect(rpcCalls(calls, "runs/sendMessage")).toEqual([
      { runId, text: "Then reading 3", interrupt: false },
      { runId, text: "Stop, wrong page", interrupt: true },
      { runId, text: "Go back", interrupt: true },
    ]);
  });

  test("each message says queued or interrupted, and when the agent picked it up", async ({
    page,
  }) => {
    await gotoRun(page);
    const queued = rec({ type: "user_message", text: "Then reading 3" });
    const now = rec({ type: "user_message", text: "Stop, wrong page", interrupt: true });
    await emit(page, [queued, now]);
    const message = (text: string) =>
      thread(page).locator(".th-item[data-kind='message']").filter({ hasText: text });
    await expect(message("Then reading 3")).toContainText("You · queued");
    await expect(message("Stop, wrong page")).toContainText("You · interrupted");
    await expect(message("Stop, wrong page")).not.toContainText("Picked up");
    await emit(page, [rec({ type: "user_messages_read", through: now.id })]);
    await expect(message("Then reading 3")).toContainText(/Picked up at \d\d:\d\d/);
    await expect(message("Stop, wrong page")).toContainText(/Picked up at \d\d:\d\d/);
  });
});

test.describe("run-mode layout (every width)", () => {
  test("the mode control, its menu, the Bypass sheet and the split send keep 44px targets and a clean screen", async ({
    page,
  }) => {
    await gotoRun(page);
    expect(await findLayoutIssues(page, { minTargetPx: 44, targetScope: ".run-mode-btn" })).toEqual(
      [],
    );
    await expect(modeButton(page)).toBeVisible();
    await modeButton(page).click();
    await expect(page.locator(".run-mode-menu")).toBeVisible();
    expect(
      await findLayoutIssues(page, { minTargetPx: 44, targetScope: ".run-mode-menu" }),
    ).toEqual([]);
    await expectCleanScreen(page);
    await page.getByRole("menuitemradio", { name: /^Bypass approvals/ }).click();
    await expect(page.getByRole("dialog", { name: "Switch this run to Bypass?" })).toBeVisible();
    await expectCleanScreen(page, { minTargetPx: 44, targetScope: ".sheet" });
    await page.keyboard.press("Escape");
    if (isPhone(page)) await page.getByRole("button", { name: /^Open thread/ }).click();
    const composer = page.locator(".run-composer-wrap").last();
    await composer.getByLabel("Message the agent").fill("Stop");
    expect(
      await findLayoutIssues(page, { minTargetPx: 44, targetScope: ".run-send-split" }),
    ).toEqual([]);
  });
});
