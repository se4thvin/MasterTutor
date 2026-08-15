import { z } from "zod";
import { ActionEffect } from "../tools/action-effect.ts";
import type { PendingCall } from "../llm/items.ts";

/** What the executor did for one model call; stored on the act step and turned into its output. */
export const CallResult = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("computer"),
    notes: z.array(z.string()),
    acknowledged: z.array(
      z.object({ id: z.string(), code: z.string().nullable(), message: z.string().nullable() }),
    ),
    /** One per executed action; absent on rows from before it was recorded and on calls not run. */
    effects: z.array(ActionEffect).optional(),
  }),
  z.object({ kind: z.literal("function"), output: z.string() }),
]);
export type CallResult = z.infer<typeof CallResult>;

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
