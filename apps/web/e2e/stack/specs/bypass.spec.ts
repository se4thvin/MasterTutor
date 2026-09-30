import { BYPASS_DECIDER, isPersonDecider } from "@mastertutor/contracts";
import { expect, test } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { E2E_SCENARIO } from "../../../../../tests/llm-mock/src/scenarios/e2e.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { frame } from "../../helpers/run.ts";
import { eventsOf, replayEvents } from "../support/events.ts";
import { rpcCall } from "../support/rpc.ts";
import { createRun, hasStatus, pendingApproval, viewerId, waitForRun } from "../support/runs.ts";

const goal = (name: string) => scenarioGoal(name, `Delete the account at ${SITE}/injection.html`);

test.describe("bypass mode (D44)", () => {
  test("the API refuses bypass without the acknowledgement", async ({ request }) => {
    const refused = await rpcCall(request, "runs/create", {
      goal: goal(E2E_SCENARIO.riskyApprove),
      allowedOrigins: [SITE],
      approvalMode: "bypass",
    });
    expect(refused.status).toBe(400);
    expect(refused.code).toBe("BAD_REQUEST");
  });

  test("New task warns, needs the tick, badges the run, and approvals are recorded as bypass", async ({
    page,
    request,
  }) => {
    await page.goto("/new");
    await page.getByLabel("Describe the task").fill(goal(E2E_SCENARIO.riskyApprove));
    await page.getByRole("button", { name: "Add domain" }).click();
    await page.getByRole("textbox", { name: "Allowed domain" }).fill(SITE);
    await page.getByRole("textbox", { name: "Allowed domain" }).press("Enter");
    await page.getByRole("radio", { name: "Bypass approvals" }).click();
    await expect(page.getByTestId("bypass-warning")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Start/ })).toBeDisabled();
    await page
      .getByRole("checkbox", { name: "I understand. Start this run in bypass mode." })
      .check();
    await page.getByRole("button", { name: /^Start/ }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    const runId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(page.getByRole("note", { name: "Bypass mode" })).toBeVisible();
    await expect(frame(page)).toContainText("Bypass");

    const run = await waitForRun(request, runId, hasStatus("completed"), "completed");
    expect(run.approvalMode).toBe("bypass");
    const resolved = eventsOf((await replayEvents(request, runId)).records, "approval_resolved");
    expect(resolved.length).toBeGreaterThan(0);
    for (const event of resolved)
      expect(event).toMatchObject({ status: "approved", decidedBy: BYPASS_DECIDER });
  });

  test("a prompt-injection warning still stops for a person, and their approval is theirs", async ({
    page,
    request,
  }) => {
    const runId = await createRun(request, {
      goal: goal(E2E_SCENARIO.riskyFlagged),
      approvalMode: "bypass",
      bypassAcknowledged: true,
    });
    const waiting = await waitForRun(
      request,
      runId,
      (r) => pendingApproval(r) !== null,
      "flagged step waits",
    );
    const approval = pendingApproval(waiting)!;
    expect(approval.request).toMatchObject({
      kind: "risky_click",
      safetyChecks: [expect.objectContaining({ code: "malicious_instructions" })],
    });
    await page.goto(`/runs/${runId}`);
    const sheet = page.getByRole("alertdialog", { name: "The model flagged this step" });
    await expect(sheet).toBeVisible();
    await expect(page.locator(".run-approval-acts[data-armed]")).toBeVisible();
    await sheet.getByRole("button", { name: /^Approve/ }).click();
    await waitForRun(request, runId, hasStatus("completed"), "completed");
    const flagged = eventsOf(
      (await replayEvents(request, runId)).records,
      "approval_resolved",
    ).find((event) => event.approvalId === approval.id);
    expect(flagged).toMatchObject({ status: "approved", decidedBy: await viewerId(request) });
    expect(isPersonDecider(flagged!.decidedBy)).toBe(true);
  });
});
