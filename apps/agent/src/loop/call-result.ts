import type { CallResult } from "@mastertutor/contracts";
import type { PendingCall } from "../llm/items.ts";

export const RESTARTED =
  "Not retried: the agent restarted before this action finished. Look at the screen and decide again.";
export const INTERRUPTED =
  "Interrupted: the user took control while this ran; it may have partly happened.";
export const NOT_STARTED = "Not run: the run was interrupted first.";
export const PAGE_CHANGED = "Not run: the page changed while waiting for approval.";

export function notRun(call: PendingCall, text: string): CallResult {
  return call.kind === "computer"
    ? { kind: "computer", notes: [text], acknowledged: [] }
    : { kind: "function", output: JSON.stringify({ error: "not_run", detail: text }) };
}

export const HANDED_OVER = "Not run: the user was asked to take over this page.";
export const OTP_PENDING = "Not run: the run is waiting for a one-time code from the user.";
