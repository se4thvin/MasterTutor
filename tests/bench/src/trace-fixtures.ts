import {
  summarizeComputerActions,
  wrapUntrusted,
  type ActionEffect,
  type ComputerAction,
  type ReadPageResult,
} from "@mastertutor/contracts";
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
/** A computer call as the executor stores it: the batch's summary plus one effect per action. */
export const batch = (actions: ComputerAction[], effects: ActionEffect[] | null): StepRow => ({
  phase: "act",
  state: "done",
  url: null,
  caption: null,
  screenshotKey: null,
  action: {
    tool: "computer",
    summary: summarizeComputerActions(actions),
    point: null,
    callId: "c",
  },
  result: {
    kind: "computer",
    notes: [],
    acknowledged: [],
    ...(effects === null ? {} : { effects }),
  },
});
const PAGE_INPUT = new Set(["click", "double_click", "drag", "keypress", "type"]);
/** One action reaching the page (or not), as the executor records it. */
export const computer = (action: ComputerAction): StepRow =>
  batch([action], [PAGE_INPUT.has(action.type) ? "input" : "passive"]);
/** A row stored before effects were recorded: only the summary is known. */
export const legacyComputer = (actions: ComputerAction[]): StepRow => batch(actions, null);
/** CTRL+L, the URL, ENTER: the executor's address bar; landed when ENTER opened that URL. */
export const addressBar = (url: string, landed = true): StepRow =>
  batch(
    [
      { type: "keypress", keys: ["CTRL", "L"] },
      { type: "type", text: url },
      { type: "keypress", keys: ["ENTER"] },
    ],
    ["address_bar", "address_bar", landed ? "address_bar_landed" : "address_bar"],
  );
const fn = (name: "read_page" | "fill_credential", output: string): StepRow => ({
  phase: "act",
  state: "done",
  url: null,
  caption: null,
  screenshotKey: null,
  action: {
    tool: name,
    summary: name.replace("_", " "),
    point: null,
    callId: "f",
  },
  result: { kind: "function", output },
});
export const readPage = (url: string, text: string): StepRow => {
  const result: ReadPageResult = { hash: "a".repeat(64), url, title: "t", text };
  return fn("read_page", wrapUntrusted(new URL(url).origin, JSON.stringify(result)));
};
/** An interactive read_page result listing links (name, raw href) as the agent records them. */
export const readLinks = (
  url: string,
  links: readonly { name: string; href?: string }[],
): StepRow => {
  const result: ReadPageResult = {
    hash: "b".repeat(64),
    url,
    title: "t",
    elements: links.map((link, i) => ({
      ref: `e${i + 1}`,
      tag: link.href ? "a" : "button",
      role: link.href ? "link" : "button",
      name: link.name,
      attrs: link.href ? { href: link.href } : {},
      point: null,
    })),
  };
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
