import { RunDetail, RunStepView, RunSummary } from "@mastertutor/contracts";
import { expect, test } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { scenarioGoal, scenarioTag } from "../../../../../tests/llm-mock/src/select.ts";
import { mockRequests } from "../support/mock.ts";
import { rpcOk } from "../support/rpc.ts";

test("a tagged run reaches a fixture page in a slot, is driven by the mock model, and completes", async ({
  request,
}) => {
  const goal = scenarioGoal("wire-shapes", `Look at ${SITE}/index.html`);
  const nonce = scenarioTag(goal)!.nonce!;
  const run = RunSummary.parse(
    await rpcOk(request, "runs/create", { goal, allowedOrigins: [SITE], approvalMode: "ask" }),
  );
  await expect
    .poll(async () => RunDetail.parse(await rpcOk(request, "runs/get", { runId: run.id })).status, {
      timeout: 90_000,
    })
    .toBe("completed");
  // The slot loaded the fixture over the fixtures network (egress allow + AGENT_TEST_MODE).
  const steps = (
    await rpcOk<{ items: unknown[] }>(request, "runs/steps", { runId: run.id })
  ).items.map((item) => RunStepView.parse(item));
  expect(steps.some((step) => step.url?.startsWith(`${SITE}/`))).toBe(true);
  // Exactly this run's two scripted turns: its own cursor, from turn 0 (P7-8).
  expect((await mockRequests(request, nonce)).map((entry) => entry.turn)).toEqual([0, 1]);
});
