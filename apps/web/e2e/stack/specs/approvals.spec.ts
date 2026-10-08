import { randomUUID } from "node:crypto";
import { POLICY_DECIDER, approvalScreenshotPath } from "@mastertutor/contracts";
import { SIGNED_OUT } from "../support/env.ts";
import { expect, test, type Page } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { E2E_SCENARIO } from "../../../../../tests/llm-mock/src/scenarios/e2e.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { eventsOf, replayEvents } from "../support/events.ts";
import { createRun, hasStatus, pendingApproval, viewerId, waitForRun } from "../support/runs.ts";

const goal = (name: string) => scenarioGoal(name, `Delete the account at ${SITE}/injection.html`);

async function decideInSheet(page: Page, runId: string, button: RegExp): Promise<void> {
  await page.goto(`/runs/${runId}`);
  const sheet = page.getByRole("alertdialog");
  await expect(sheet).toContainText("Delete account");
  await expect(page.locator(".run-approval-acts[data-armed]")).toBeVisible();
  await sheet.getByRole("button", { name: button }).click();
  await expect(sheet).toBeHidden();
}

test.describe("approvals", () => {
  test("a person approves a risky click; the event records their id and the timeline says You (D11, D7)", async ({
    page,
    request,
    playwright,
    baseURL,
  }) => {
    const runId = await createRun(request, { goal: goal(E2E_SCENARIO.riskyApprove) });
    const waiting = await waitForRun(
      request,
      runId,
      (r) => pendingApproval(r) !== null,
      "approval pending",
    );
    const approval = pendingApproval(waiting)!;
    expect(approval.kind).toBe("risky_click");

    // D7: the browser names the approval; the server reads its screenshot key.
    const shot = await request.get(approvalScreenshotPath(runId, approval.id));
    expect(shot.status()).toBe(200);
    expect(shot.headers()["content-type"]).toBe("image/png");
    const unknown = await request.get(approvalScreenshotPath(runId, randomUUID()), {
      failOnStatusCode: false,
    });
    expect(unknown.status()).toBe(404);
    const anonymous = await playwright.request.newContext({ baseURL, ...SIGNED_OUT });
    expect((await anonymous.get(approvalScreenshotPath(runId, approval.id))).status()).toBe(401);
    await anonymous.dispose();

    await decideInSheet(page, runId, /^Approve/);
    await waitForRun(request, runId, hasStatus("completed"), "completed"); // doneSeeing("Account deleted")
    const resolved = eventsOf((await replayEvents(request, runId)).records, "approval_resolved");
    expect(resolved).toEqual([
      expect.objectContaining({
        approvalId: approval.id,
        status: "approved",
        decidedBy: await viewerId(request),
      }),
    ]);
    await expect(page.getByText(/^You approved/)).toBeVisible();
  });

  test("a denied risky click is never performed", async ({ page, request }) => {
    const runId = await createRun(request, { goal: goal(E2E_SCENARIO.riskyDeny) });
    await waitForRun(request, runId, (r) => pendingApproval(r) !== null, "approval pending");
    await decideInSheet(page, runId, /^Deny/);
    await waitForRun(request, runId, hasStatus("completed"), "completed"); // doneNotSeeing("Account deleted")
    const resolved = eventsOf((await replayEvents(request, runId)).records, "approval_resolved");
    expect(resolved).toEqual([
      expect.objectContaining({ status: "denied", decidedBy: await viewerId(request) }),
    ]);
  });

  test("auto_within_allowlist approves the same click by policy and records it as policy", async ({
    request,
  }) => {
    const runId = await createRun(request, {
      goal: goal(E2E_SCENARIO.riskyApprove),
      approvalMode: "auto_within_allowlist",
    });
    await waitForRun(request, runId, hasStatus("completed"), "completed");
    const resolved = eventsOf((await replayEvents(request, runId)).records, "approval_resolved");
    expect(resolved.length).toBeGreaterThan(0);
    for (const event of resolved)
      expect(event).toMatchObject({ status: "approved", decidedBy: POLICY_DECIDER });
  });
});
