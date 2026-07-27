import {
  TERMINAL_RUN_STATUSES,
  type RunEventRecord,
  type RunStatus,
  type WaitReason,
} from "@mastertutor/contracts";
import type { BenchApi } from "./app-client.ts";
import { streamRunEvents } from "./sse.ts";

export interface WatchPolicy {
  /** finish_now: the harness ends the run at its budget (fixtures). ask_human: a person decides (zyBooks, D46). */
  onBudget: "finish_now" | "ask_human";
  /** deny: the harness denies a safety check at once. ask_human: a person decides. Never approve (D44). */
  onSafetyCheck: "deny" | "ask_human";
  humanTimeoutMs: number;
  stallMs: number;
}

export interface WatchState {
  status: RunStatus;
  waitReason: WaitReason | null;
  lastProgressAt: number;
  /** When the current human wait started; null while none, or while the user holds control. */
  humanSince: number | null;
  humanWait: WaitReason | null;
  userControl: boolean;
  pendingApprovals: string[];
  safetyChecks: string[];
  budgetHit: boolean;
  takeovers: number;
  stalled: boolean;
  spendCapHit: boolean;
  cancelRequested: boolean;
  done: boolean;
}

export type WatchCommand =
  | { type: "decide_budget"; approvalId: string }
  | { type: "deny_approval"; approvalId: string }
  | { type: "cancel"; reason: "stall" | "human_timeout" | "spend_cap" }
  | { type: "log"; line: string };

const TERMINAL: readonly RunStatus[] = TERMINAL_RUN_STATUSES;

export function initialWatchState(now: number): WatchState {
  return {
    status: "queued",
    waitReason: null,
    lastProgressAt: now,
    humanSince: null,
    humanWait: null,
    userControl: false,
    pendingApprovals: [],
    safetyChecks: [],
    budgetHit: false,
    takeovers: 0,
    stalled: false,
    spendCapHit: false,
    cancelRequested: false,
    done: false,
  };
}

/** Any waiting status is a human wait (X12): the policy decides its own approvals at once. */
function humanClock(s: WatchState, now: number, previous: number | null): number | null {
  if (s.userControl || s.status !== "waiting") return null;
  return previous ?? now;
}

export function onRecord(
  state: WatchState,
  record: RunEventRecord,
  now: number,
  policy: WatchPolicy,
): { state: WatchState; commands: WatchCommand[] } {
  const s: WatchState = {
    ...state,
    pendingApprovals: [...state.pendingApprovals],
    safetyChecks: [...state.safetyChecks],
  };
  const commands: WatchCommand[] = [];
  const event = record.event;
  switch (event.type) {
    case "status":
      s.status = event.status;
      s.waitReason = event.waitReason;
      s.lastProgressAt = now;
      s.humanWait = event.status === "waiting" ? event.waitReason : null;
      s.humanSince = humanClock(s, now, state.status === "waiting" ? state.humanSince : null);
      if (s.humanWait)
        commands.push({ type: "log", line: `NEEDS HUMAN (${s.humanWait}): ${event.reason ?? ""}` });
      if (TERMINAL.includes(event.status)) s.done = true;
      commands.push({
        type: "log",
        line: `status ${event.status}${event.waitReason ? `(${event.waitReason})` : ""}`,
      });
      break;
    case "step":
      s.lastProgressAt = now;
      if (event.state === "done")
        commands.push({
          type: "log",
          line: `#${event.seq} ${event.phase} ${event.caption ?? ""}`.trim(),
        });
      break;
    case "approval_requested": {
      s.pendingApprovals.push(event.approvalId);
      const request = event.request;
      if (request.kind === "budget") {
        s.budgetHit = true;
        if (policy.onBudget === "finish_now")
          commands.push({ type: "decide_budget", approvalId: event.approvalId });
        commands.push({
          type: "log",
          line: `budget hit (${request.exceeded}) -> ${policy.onBudget === "finish_now" ? "finish now" : "NEEDS HUMAN"}`,
        });
      } else if (request.kind === "risky_click" && request.safetyChecks?.length) {
        const codes = request.safetyChecks.map((check) => check.code ?? "unknown");
        s.safetyChecks.push(...codes);
        if (policy.onSafetyCheck === "deny")
          commands.push({ type: "deny_approval", approvalId: event.approvalId });
        commands.push({
          type: "log",
          line: `safety check ${codes.join(",")} -> ${policy.onSafetyCheck === "deny" ? "denied" : "NEEDS HUMAN"}`,
        });
      } else {
        commands.push({ type: "log", line: `approval requested: ${request.kind}` });
      }
      break;
    }
    case "approval_resolved":
      s.pendingApprovals = s.pendingApprovals.filter((id) => id !== event.approvalId);
      commands.push({ type: "log", line: `approval ${event.status} by ${event.decidedBy}` });
      break;
    case "control":
      s.userControl = event.holder === "user";
      if (event.holder === "user") s.takeovers = state.takeovers + 1;
      // The timer pauses while a person holds control and restarts when they hand back (P10a-18).
      s.humanSince = humanClock(s, now, null);
      commands.push({ type: "log", line: `control -> ${event.holder}` });
      break;
    case "error":
      commands.push({ type: "log", line: `error ${event.code}: ${event.message}` });
      break;
    default:
      break;
  }
  return { state: s, commands };
}

export function onTick(
  state: WatchState,
  now: number,
  policy: WatchPolicy,
): { state: WatchState; commands: WatchCommand[] } {
  if (state.done || state.cancelRequested) return { state, commands: [] };
  if (state.humanSince !== null && now - state.humanSince > policy.humanTimeoutMs)
    return {
      state: { ...state, cancelRequested: true },
      commands: [{ type: "cancel", reason: "human_timeout" }],
    };
  if (state.status === "running" && now - state.lastProgressAt > policy.stallMs)
    return {
      state: { ...state, stalled: true, cancelRequested: true },
      commands: [{ type: "cancel", reason: "stall" }],
    };
  return { state, commands: [] };
}

export interface WatchDeps {
  api: BenchApi;
  baseUrl: string;
  cookie: string;
  log(line: string): void;
  now(): number;
  /** True once the total spend cap is reached (D46); polled while watching. */
  spendCapReached?: () => Promise<boolean>;
  /** Test seams; production uses streamRunEvents, 5 s ticks and a 60 s spend poll. */
  stream?: (runId: string, signal: AbortSignal) => AsyncIterable<RunEventRecord>;
  tickMs?: number;
  spendPollMs?: number;
}

export async function watchRun(
  deps: WatchDeps,
  runId: string,
  policy: WatchPolicy,
): Promise<WatchState> {
  let state = initialWatchState(deps.now());
  const controller = new AbortController();
  const tag = `[${runId.slice(0, 8)}]`;
  const apply = async (commands: WatchCommand[]) => {
    for (const command of commands) {
      if (command.type === "log") deps.log(`${tag} ${command.line}`);
      else if (command.type === "decide_budget")
        await deps.api.runs.decideApproval({
          approvalId: command.approvalId,
          decision: "approved",
          budgetChoice: "finish_now",
        });
      else if (command.type === "deny_approval")
        await deps.api.runs.decideApproval({ approvalId: command.approvalId, decision: "denied" });
      else {
        deps.log(`${tag} cancelling: ${command.reason}`);
        await deps.api.runs.cancel({ runId });
      }
    }
  };
  const safely = (commands: WatchCommand[]) =>
    apply(commands).catch((error: unknown) =>
      deps.log(`${tag} command failed: ${(error as Error).message}`),
    );
  let lastSpendCheck = 0;
  const ticker = setInterval(() => {
    const now = deps.now();
    const result = onTick(state, now, policy);
    state = result.state;
    void safely(result.commands);
    if (
      !deps.spendCapReached ||
      state.done ||
      state.cancelRequested ||
      now - lastSpendCheck < (deps.spendPollMs ?? 60_000)
    )
      return;
    lastSpendCheck = now;
    void deps
      .spendCapReached()
      .then((reached) => {
        if (!reached || state.cancelRequested || state.done) return;
        state = { ...state, spendCapHit: true, cancelRequested: true };
        return safely([{ type: "cancel", reason: "spend_cap" }]);
      })
      .catch((error: unknown) =>
        deps.log(`${tag} spend check failed: ${(error as Error).message}`),
      );
  }, deps.tickMs ?? 5_000);
  const stream =
    deps.stream ??
    ((id: string, signal: AbortSignal) =>
      streamRunEvents({ baseUrl: deps.baseUrl, cookie: deps.cookie, runId: id, signal }));
  try {
    for await (const record of stream(runId, controller.signal)) {
      const result = onRecord(state, record, deps.now(), policy);
      state = result.state;
      await safely(result.commands);
      if (state.done) break;
    }
  } finally {
    clearInterval(ticker);
    controller.abort();
  }
  return state;
}
