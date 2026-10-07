import { readFileSync } from "node:fs";
import {
  BYPASS_DECIDER,
  POLICY_DECIDER,
  SignedUrl,
  type ApprovalMode,
} from "@mastertutor/contracts";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { E2E_SCENARIO } from "../../../../../tests/llm-mock/src/scenarios/e2e.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { eventsOf, replayEvents } from "../support/events.ts";
import { rpcOk } from "../support/rpc.ts";
import {
  createRun,
  decide,
  hasStatus,
  pendingApproval,
  viewerId,
  waitForRun,
} from "../support/runs.ts";

const REPORT = readFileSync(
  new URL("../../../../../tests/fixtures/sites/site/files/report.csv", import.meta.url),
  "utf8",
);

/** `refused`: a scenario for a denied download, whose model does not repeat the click. */
async function downloadRun(
  request: APIRequestContext,
  mode: ApprovalMode,
  refused = false,
): Promise<string> {
  const scenario = refused ? E2E_SCENARIO.downloadRefused : E2E_SCENARIO.downloadReport;
  return createRun(request, {
    goal: scenarioGoal(scenario, `Get the quarterly report at ${SITE}/download.html`),
    approvalMode: mode,
    ...(mode === "bypass" ? { bypassAcknowledged: true as const } : {}),
  });
}

async function finished(request: APIRequestContext, runId: string) {
  await waitForRun(request, runId, hasStatus("completed"), "completed");
  const records = (await replayEvents(request, runId)).records;
  return {
    ready: eventsOf(records, "download_ready"),
    resolved: eventsOf(records, "approval_resolved"),
  };
}

/** assets.url is B2's (P3): Task 0C wires it, then removes ASSETS_FIXME. */
const ASSETS_FIXME =
  "assets.url is wired by Task 0C once B2/B4/B5 (P3) merges; it removes this fixme";

async function expectStored(request: APIRequestContext, assetId: string): Promise<void> {
  const { url } = SignedUrl.parse(await rpcOk(request, "assets/url", { assetId }));
  const file = await request.get(url);
  expect(file.status()).toBe(200);
  expect(await file.text()).toBe(REPORT);
}

test.describe("agent downloads (§3.4, P7-25)", () => {
  test("ask: a person approves, and the file is stored in Garage and served back", async ({
    request,
  }) => {
    const runId = await downloadRun(request, "ask");
    const waiting = await waitForRun(
      request,
      runId,
      (r) => pendingApproval(r) !== null,
      "download approval",
    );
    const approval = pendingApproval(waiting)!;
    expect(approval.kind).toBe("download");
    await decide(request, approval.id, "approved");
    const { ready } = await finished(request, runId);
    expect(ready).toEqual([expect.objectContaining({ filename: "report.csv" })]);
  });

  test("ask: a denied download saves nothing", async ({ request }) => {
    const runId = await downloadRun(request, "ask", true);
    const waiting = await waitForRun(
      request,
      runId,
      (r) => pendingApproval(r) !== null,
      "download approval",
    );
    await decide(request, pendingApproval(waiting)!.id, "denied");
    const { ready, resolved } = await finished(request, runId);
    expect(ready).toEqual([]);
    expect(resolved).toEqual([
      expect.objectContaining({ status: "denied", decidedBy: await viewerId(request) }),
    ]);
  });

  test("auto: downloads stay blocked, recorded as policy", async ({ request }) => {
    const runId = await downloadRun(request, "auto_within_allowlist", true);
    const { ready, resolved } = await finished(request, runId);
    expect(ready).toEqual([]);
    expect(resolved).toContainEqual(
      expect.objectContaining({ status: "denied", decidedBy: POLICY_DECIDER }),
    );
  });

  test("bypass: the download is approved as bypass and stored", async ({ request }) => {
    const runId = await downloadRun(request, "bypass");
    const { ready, resolved } = await finished(request, runId);
    expect(resolved).toContainEqual(
      expect.objectContaining({ status: "approved", decidedBy: BYPASS_DECIDER }),
    );
    expect(ready).toHaveLength(1);
  });

  test("an approved download is stored in Garage and served back through assets.url", async ({
    request,
  }) => {
    test.fixme(true, ASSETS_FIXME);
    const runId = await downloadRun(request, "bypass");
    const { ready } = await finished(request, runId);
    await expectStored(request, ready[0]!.assetId);
  });
});
