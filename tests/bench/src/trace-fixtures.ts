import type { ComputerAction, ReadPageResult } from "@mastertutor/contracts";
import { describeCall } from "../../../apps/agent/src/llm/items.ts";
import { wrapUntrusted } from "../../../apps/agent/src/tools/untrusted.ts";
import { parseTrace, type RunTrace, type TraceApproval } from "./evidence.ts";

export interface StepRow {
  phase: "observe" | "act";
  state: "done";
  url: string | null;
  caption: null;
  screenshotKey: string | null;
  action: unknown;
  result: unknown;
}

let shot = 0;
export const observe = (url: string): StepRow => ({
  phase: "observe",
  state: "done",
  url,
  caption: null,
  screenshotKey: `runs/r/steps/${++shot}-k${shot}.png`,
  action: null,
  result: { url, title: "t", domHash: "h" },
});
export const computer = (action: ComputerAction): StepRow => ({
  phase: "act",
  state: "done",
  url: null,
  caption: null,
  screenshotKey: null,
  action: {
    ...describeCall(
      { kind: "computer", callId: "c", actions: [action], safetyChecks: [], invalid: null },
      1,
    ),
    callId: "c",
  },
  result: { kind: "computer", notes: [], acknowledged: [] },
});
const fn = (name: "read_page" | "fill_credential", output: string): StepRow => ({
  phase: "act",
  state: "done",
  url: null,
  caption: null,
  screenshotKey: null,
  action: {
    ...describeCall({ kind: "function", callId: "f", name, args: {}, invalid: null }, 1),
    callId: "f",
  },
  result: { kind: "function", output },
});
export const readPage = (url: string, text: string): StepRow => {
  const result: ReadPageResult = { hash: "a".repeat(64), url, title: "t", text };
  return fn("read_page", wrapUntrusted(new URL(url).origin, JSON.stringify(result)));
};
export const readPageFailed = (): StepRow =>
  fn("read_page", JSON.stringify({ error: "tool_failed" }));
export const fill = (error: string | null): StepRow =>
  fn("fill_credential", JSON.stringify(error === null ? { ok: true } : { error }));

export function traceOf(
  rows: StepRow[],
  over: { status?: RunTrace["status"]; finalUrl?: string | null; approvals?: TraceApproval[] } = {},
): RunTrace {
  return parseTrace("r", {
    status: over.status ?? "completed",
    waitReason: null,
    finalUrl: over.finalUrl ?? null,
    steps: rows.map((row, i) => ({ seq: i + 1, ...row })),
    approvals: over.approvals ?? [],
  });
}
