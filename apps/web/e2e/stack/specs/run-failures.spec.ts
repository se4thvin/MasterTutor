import { expect, test } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { E2E_SCENARIO } from "../../../../../tests/llm-mock/src/scenarios/e2e.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { eventsOf, replayEvents } from "../support/events.ts";
import { createRun, hasStatus, waitForRun } from "../support/runs.ts";

test("a model that rejects the request fails the run with its own code, not agent_error (D35, B1 M2)", async ({
  request,
}) => {
  const runId = await createRun(request, {
    goal: scenarioGoal(E2E_SCENARIO.modelRejected, `Read ${SITE}/`),
  });
  await waitForRun(request, runId, hasStatus("failed"), "failed");
  const codes = eventsOf((await replayEvents(request, runId)).records, "error").map((e) => e.code);
  expect(codes).toContain("model_request_rejected");
  expect(codes).not.toContain("agent_error");
});
