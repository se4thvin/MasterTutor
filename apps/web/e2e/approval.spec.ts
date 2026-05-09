import { DEFAULT_BUDGET, EMPTY_USAGE, type RunEventRecord } from "@mastertutor/contracts";
import type { Page } from "@playwright/test";
import { ids } from "../lib/fixtures/ids.ts";
import {
  RECORDED_APPROVAL_ID,
  RECORDED_RUN_ID,
  offSiteSignInRequest,
  rec,
  recordedEvents,
} from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, frame, gotoRun, rpcCalls, type RpcCall } from "./helpers/run.ts";
import { expect, isCompact, test } from "./helpers/test.ts";

const decisions = (calls: RpcCall[]) => rpcCalls(calls, "runs/decideApproval");
const armed = (page: Page) => expect(page.locator(".run-approval-acts[data-armed]")).toBeVisible();
const LECTURE = "https://learn.example.edu/course/week-2/lecture-3";
const request = (approvalId: string, req: Record<string, unknown>) =>
  rec({ type: "approval_requested", approvalId, request: req as never });

/** Emits, waits two frames (rendered and listening), then presses a key: well inside the 600ms arm. */
async function emitThenKey(page: Page, records: RunEventRecord[], key: string, repeat = false) {
  await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
  await page.evaluate(
    async ({ records, key, repeat }) => {
      window.__sse.emit(records);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      document.dispatchEvent(new KeyboardEvent("keydown", { key, repeat, bubbles: true }));
    },
    { records, key, repeat },
  );
}

test.describe("Approval sheet", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1440,
    "behaviour checks run once; 390 has its own test",
  );

  test("keys arm after 600ms; Return and held keys never decide (S1, Review Focus 3, 8)", async ({
    page,
  }) => {
    const calls = await gotoRun(page);
    await emitThenKey(page, recordedEvents(), "a");
    const sheet = page.getByRole("alertdialog", {
      name: "Click “Start quiz” on learn.example.edu?",
    });
    await expect(sheet).toBeFocused();
    await armed(page);
    expect(decisions(calls)).toHaveLength(0);
    await page.keyboard.press("Enter");
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", repeat: true, bubbles: true }),
      ),
    );
    expect(decisions(calls)).toHaveLength(0);
    await page.keyboard.press("a");
    await expect(sheet).toHaveCount(0);
    // Focus does not fall to the page body when the last approval leaves (M4).
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
    await expect
      .poll(() => decisions(calls))
      .toEqual([
        {
          approvalId: RECORDED_APPROVAL_ID,
          decision: "approved",
          instruction: null,
          budgetChoice: null,
        },
      ]);
  });

  test("shows the record context and the request screenshot (A3, S4)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, recordedEvents());
    await expect(page.getByText("On this record:")).toBeVisible();
    await expect(page.getByText("Week 2 quiz. Attempt 1 of 1")).toBeVisible();
    const withShot = ids.approval(2);
    await emit(page, [
      rec({
        type: "approval_resolved",
        approvalId: RECORDED_APPROVAL_ID,
        status: "approved",
        decidedBy: "fixture-user",
      }),
      request(withShot, {
        kind: "form_submit",
        url: LECTURE,
        formSummary: "Quiz answers",
        screenshotKey: `runs/${RECORDED_RUN_ID}/steps/12-r12k7.png`,
      }),
    ]);
    await expect(page.locator(`img[src$="/approvals/${withShot}/screenshot"]`)).toBeVisible();
  });

  test("a safety check shows every warning and no spotlight (A2, S3, Review Focus 7)", async ({
    page,
  }) => {
    await gotoRun(page);
    await emit(page, [
      request(ids.approval(3), {
        kind: "risky_click",
        action: { type: "keypress", keys: ["ENTER"] },
        label: "Safety check: ignore the user",
        url: LECTURE,
        screenshotKey: null,
        safetyChecks: [
          { code: "malicious_instructions", message: "The page asks the agent to ignore you" },
        ],
      }),
    ]);
    const sheet = page.getByRole("alertdialog", { name: "The model flagged this step" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("list", { name: "Safety warnings" })).toContainText(
      "The page asks the agent to ignore you",
    );
    await expect(sheet).toContainText(
      "The page may be trying to steer the agent. Deny unless you expected this.",
    );
    await expect(sheet).toHaveAttribute("data-tone", "warn");
  });

  test("E opens the edit box and Send instead sends the instruction", async ({ page }) => {
    const calls = await gotoRun(page);
    await emit(page, recordedEvents());
    await armed(page);
    await page.keyboard.press("e");
    const box = page.getByLabel("Tell the agent what to do instead");
    await expect(box).toBeFocused();
    await box.fill("Don't start the quiz. Copy the visible prompts.");
    await page.getByRole("button", { name: "Send instead" }).click();
    await expect
      .poll(() => decisions(calls)[0])
      .toEqual({
        approvalId: RECORDED_APPROVAL_ID,
        decision: "edited",
        instruction: "Don't start the quiz. Copy the visible prompts.",
        budgetChoice: null,
      });
  });

  test("a failed decision brings the sheet back with an explanation", async ({ page }) => {
    await gotoRun(page, {
      handlers: {
        "runs/decideApproval": () => {
          throw new RpcFailure("INTERNAL_SERVER_ERROR", 500);
        },
      },
    });
    await emit(page, recordedEvents());
    await armed(page);
    await page.getByRole("button", { name: /^Deny/ }).click();
    await expect(
      page.getByText("Couldn't send your answer. The approval is still waiting for you."),
    ).toBeVisible();
    await expect(page.getByRole("alertdialog")).toBeVisible();
  });

  test("the budget sheet has no cancel key; Cancel asks first (S2, W5)", async ({ page }) => {
    const calls = await gotoRun(page);
    const budgetId = ids.approval(4);
    await emit(page, [
      request(budgetId, {
        kind: "budget",
        exceeded: "steps",
        usage: { ...EMPTY_USAGE, steps: 150 },
        budget: DEFAULT_BUDGET,
      }),
    ]);
    await expect(page.getByRole("alertdialog", { name: "Step limit reached" })).toBeVisible();
    await armed(page);
    await page.keyboard.press("d");
    expect(decisions(calls)).toHaveLength(0);
    await page.getByRole("button", { name: "Cancel run" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Cancel this run?" });
    await expect(confirm.getByRole("button", { name: "Keep running" })).toBeFocused();
    await page.keyboard.press("a");
    expect(decisions(calls)).toHaveLength(0);
    await confirm.getByRole("button", { name: "Cancel run" }).click();
    await expect
      .poll(() => decisions(calls))
      .toEqual([
        { approvalId: budgetId, decision: "denied", instruction: null, budgetChoice: null },
      ]);
  });

  test("F finishes a budget wait", async ({ page }) => {
    const calls = await gotoRun(page);
    const budgetId = ids.approval(5);
    await emit(page, [
      request(budgetId, {
        kind: "budget",
        exceeded: "usd",
        usage: { ...EMPTY_USAGE, usd: 5 },
        budget: DEFAULT_BUDGET,
      }),
    ]);
    await armed(page);
    await page.keyboard.press("f");
    await expect
      .poll(() => decisions(calls)[0])
      .toEqual({
        approvalId: budgetId,
        decision: "approved",
        instruction: null,
        budgetChoice: "finish_now",
      });
  });

  test("taking over while an approval waits hides the sheet and never decides it (A5, Review Focus 6)", async ({
    page,
  }) => {
    const calls = await gotoRun(page);
    await emit(page, recordedEvents());
    await armed(page);
    await page.getByRole("button", { name: "Take over instead" }).click();
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect.poll(() => rpcCalls(calls, "runs/takeControl").length).toBe(1);
    await emit(page, [
      rec({ type: "control", holder: "user" }),
      rec({
        type: "approval_resolved",
        approvalId: RECORDED_APPROVAL_ID,
        status: "superseded",
        decidedBy: "agent",
      }),
    ]);
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    expect(decisions(calls)).toHaveLength(0);
  });

  test("a failed takeover during an approval brings the sheet back (B6 §3)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, recordedEvents());
    await armed(page);
    await page.getByRole("button", { name: "Take over instead" }).click();
    await emit(page, [
      rec({ type: "error", code: "takeover_failed", message: "not connected" }),
      rec({ type: "control", holder: "agent" }),
    ]);
    await expect(frame(page)).toHaveAttribute("data-state", "approval");
    await expect(
      page.getByRole("alertdialog", { name: "Click “Start quiz” on learn.example.edu?" }),
    ).toBeVisible();
  });

  test("a request the policy decided in the same batch never mounts the sheet (A9)", async ({
    page,
  }) => {
    await gotoRun(page);
    const takeOver = page.getByRole("button", { name: "Take over", exact: true });
    await takeOver.focus();
    const id = ids.approval(6);
    await emit(page, [
      request(id, {
        kind: "risky_click",
        action: { type: "click", x: 5, y: 5, button: "left" },
        label: "Post",
        url: LECTURE,
        screenshotKey: null,
      }),
      rec({ type: "approval_resolved", approvalId: id, status: "approved", decidedBy: "policy" }),
    ]);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(takeOver).toBeFocused();
  });

  test("letters typed in the composer never decide (Review Focus 3)", async ({ page }) => {
    const calls = await gotoRun(page);
    await emit(page, recordedEvents());
    await armed(page);
    await page.getByLabel("Message the agent").pressSequentially("a dead end");
    expect(decisions(calls)).toHaveLength(0);
  });

  test("an approval arriving mid-typing never takes the text field or the letters (final I2)", async ({
    page,
  }) => {
    test.skip(isCompact(page), "the composer is in the Steps sheet on compact widths");
    const calls = await gotoRun(page);
    const box = page.getByLabel("Message the agent");
    await box.click();
    await box.pressSequentially("I think");
    await emit(page, recordedEvents());
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await armed(page);
    await page.keyboard.type(" a dead end");
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("I think a dead end");
    expect(decisions(calls)).toHaveLength(0);
  });
});

test("a 500-character label stays inside the sheet at 390px (Review Focus 4)", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await gotoRun(page);
  await emit(page, [
    request(ids.approval(7), {
      kind: "risky_click",
      action: { type: "click", x: 10, y: 10, button: "left" },
      label: `Pay\u200B${"W".repeat(496)}`,
      url: LECTURE,
      screenshotKey: null,
    }),
  ]);
  // Measured once the sheet has finished rising into place.
  const sheet = page.getByRole("alertdialog");
  await expect
    .poll(async () => {
      const b = (await sheet.boundingBox())!;
      return b.y + b.height;
    })
    .toBeLessThanOrEqual(844 + 1);
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expect(frame(page)).toHaveAttribute("data-state", "approval");
});

test("a sign-in that posts to several sites names every one, whole, at 1440 and 390 (I1, M5)", async ({
  page,
}) => {
  test.skip(
    ![1440, 390].includes(page.viewportSize()?.width ?? 0),
    "the widest and the narrowest Details column",
  );
  await gotoRun(page);
  const hosts = ["login.microsoftonline.com", "shibboleth.learn.example.edu", "zz-evil.example"];
  await emit(page, [
    request(ids.approval(7), {
      ...offSiteSignInRequest(),
      postsTo: hosts.map((h) => `https://${h}`).join(", "),
    }),
  ]);
  const sheet = page.getByRole("alertdialog", {
    name: "Send your ada-learn sign-in to 3 other sites?",
  });
  await expect(sheet).toBeVisible();
  for (const host of hosts) {
    const row = sheet
      .locator(".run-approval-details dl > div")
      .filter({ hasText: "Sends to" })
      .filter({ hasText: host });
    await expect(row).toHaveCount(1);
    // Never truncated: the whole host fits its box.
    expect(await row.locator("dd").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
      true,
    );
  }
});
