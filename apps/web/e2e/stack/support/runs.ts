import {
  RunDetail,
  RunStepView,
  RunSummary,
  TERMINAL_RUN_STATUSES,
  type ApprovalMode,
  type ApprovalView,
  type RunStatus,
} from "@mastertutor/contracts";
import type { APIRequestContext } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { rpcOk } from "./rpc.ts";

export interface NewRun {
  goal: string;
  allowedOrigins?: string[];
  approvalMode?: ApprovalMode;
  bypassAcknowledged?: true;
}

export async function createRun(request: APIRequestContext, input: NewRun): Promise<string> {
  const run = RunSummary.parse(
    await rpcOk(request, "runs/create", { allowedOrigins: [SITE], approvalMode: "ask", ...input }),
  );
  return run.id;
}

export async function getRun(request: APIRequestContext, runId: string): Promise<RunDetail> {
  return RunDetail.parse(await rpcOk(request, "runs/get", { runId }));
}

export async function runSteps(request: APIRequestContext, runId: string): Promise<RunStepView[]> {
  const page = await rpcOk<{ items: unknown }>(request, "runs/steps", { runId });
  return RunStepView.array().parse(page.items);
}

const TERMINAL: readonly RunStatus[] = TERMINAL_RUN_STATUSES;

/** Test-only API polling (the product streams). A terminal run that missed `until` fails at once. */
export async function waitForRun(
  request: APIRequestContext,
  runId: string,
  until: (run: RunDetail) => boolean,
  label: string,
  timeoutMs = 90_000,
): Promise<RunDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await getRun(request, runId);
    if (until(run)) return run;
    if (TERMINAL.includes(run.status) || Date.now() > deadline) {
      throw new Error(
        `run ${runId}: "${label}" not reached (${run.status}/${run.waitReason ?? "-"})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export const hasStatus =
  (...statuses: RunStatus[]) =>
  (run: RunDetail): boolean =>
    statuses.includes(run.status);

export const pendingApproval = (run: RunDetail): ApprovalView | null =>
  run.pendingApprovals[0] ?? null;

export async function decide(
  request: APIRequestContext,
  approvalId: string,
  decision: "approved" | "denied",
): Promise<void> {
  await rpcOk(request, "runs/decideApproval", {
    approvalId,
    decision,
    instruction: null,
    budgetChoice: null,
  });
}

/** The signed-in viewer's user id (what decidedBy must hold for a person's decision, D11). */
export async function viewerId(request: APIRequestContext): Promise<string> {
  const body = (await (await request.get("/api/auth/get-session")).json()) as {
    user?: { id?: unknown };
  } | null;
  if (typeof body?.user?.id !== "string") throw new Error("no signed-in viewer");
  return body.user.id;
}

/**
 * A finished run with step screenshots: the llm-mock's wire-shapes scenario on the fixture site.
 * (The capture-to-note run waits for B2/B4/B5, P3.)
 */
export async function finishedRun(request: APIRequestContext): Promise<RunDetail> {
  const runId = await createRun(request, {
    goal: scenarioGoal("wire-shapes", `Look at ${SITE}/index.html`),
  });
  return waitForRun(request, runId, hasStatus("completed"), "completed");
}
