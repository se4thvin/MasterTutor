import { expect, test } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { RUN_MESSAGES } from "../../../lib/server/runs/messages.ts";
import { rpcCall, rpcOk } from "../support/rpc.ts";
import { createRun, hasStatus, waitForRun } from "../support/runs.ts";

// Task 2's long-wait: one model turn held for 120 s, so the run stays `running`.
const hold = () => scenarioGoal("long-wait", `Wait on ${SITE}/`);

test("the kill switch cancels running work within seconds, refuses new runs while on, and starts them again once cleared (P7-28)", async ({
  page,
  request,
}) => {
  const running = await createRun(request, { goal: hold() });
  await waitForRun(request, running, hasStatus("running"), "running");
  try {
    await page.goto("/settings");
    await page.getByRole("switch", { name: "Kill switch" }).click();
    const alert = page.getByRole("alertdialog", { name: "Stop all runs?" });
    await expect(alert).toBeVisible();
    const pressed = Date.now();
    await alert.getByRole("button", { name: "Stop All Runs" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Kill switch is on." })).toBeVisible();
    await waitForRun(request, running, hasStatus("cancelled"), "cancelled", 5_000);
    expect(Date.now() - pressed).toBeLessThan(5_000);

    // While the switch is on, no run starts: the product refuses the create itself (Task 0A).
    const refused = await rpcCall(request, "runs/create", { goal: hold(), allowedOrigins: [SITE] });
    expect(refused.status).toBe(409);
    expect(refused.code).toBe("CONFLICT");
    expect(JSON.stringify(refused.json)).toContain(RUN_MESSAGES.killSwitchOn);

    await rpcOk(request, "settings/setKillSwitch", { on: false });
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Kill switch is on." })).toBeHidden();
    // Cleared: a new run is claimed and starts without a restart.
    const after = await createRun(request, { goal: hold() });
    await waitForRun(request, after, hasStatus("running"), "running after the switch-off", 30_000);
    await rpcOk(request, "runs/cancel", { runId: after });
  } finally {
    await rpcOk(request, "settings/setKillSwitch", { on: false });
  }
});
