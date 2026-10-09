import { z } from "zod";
import { AgentTurnStatus } from "./enums.ts";
import type { ComputerAction } from "./tools.ts";

/** The longest reasoning summary a decide step keeps (characters, after redaction). */
export const REASONING_SUMMARY_MAX = 4_000;

/**
 * The model's reasoning summary for one turn (Responses `reasoning.summary: "auto"`), never its
 * hidden reasoning. Model text that can quote the page: cleaned and vault-redacted by the agent,
 * shown as plain text only (run view thread).
 */
export const ReasoningSummary = z.string().min(1).max(REASONING_SUMMARY_MAX);

/**
 * What one executed computer action did, recorded per action (a batch can hide a click behind a
 * move): passive (move, scroll, wait, screenshot), input (reached the page), navigate (back,
 * forward, reload), address_bar (went to the agent's emulated address bar), address_bar_landed
 * (the ENTER that opened exactly the URL typed there), disclosure (a click that only expanded or
 * collapsed a disclosure control, with the URL unchanged). The benchmark grader reads it.
 */
export const ACTION_EFFECTS = [
  "passive",
  "input",
  "navigate",
  "address_bar",
  "address_bar_landed",
  "disclosure",
] as const;
export const ActionEffect = z.enum(ACTION_EFFECTS);
export type ActionEffect = z.infer<typeof ActionEffect>;

/**
 * Where a page-input action landed, for grading per activity: the target's accessible label and the
 * opening text of its enclosing elements, innermost first. Page text, vault secrets redacted.
 */
export const ActionTarget = z.object({
  label: z.string().max(200),
  ancestors: z.array(z.string().max(200)).max(8),
});
export type ActionTarget = z.infer<typeof ActionTarget>;

/**
 * What the agent did for one model call: stored as an act step's `run_steps.result`, turned into
 * the call's output, and read back by the benchmark grader.
 */
export const CallResult = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("computer"),
    notes: z.array(z.string()),
    acknowledged: z.array(
      z.object({ id: z.string(), code: z.string().nullable(), message: z.string().nullable() }),
    ),
    /** One per executed action; absent on rows from before it was recorded and on calls not run. */
    effects: z.array(ActionEffect).optional(),
    /** Aligned with `effects`: the target of each click, type or key press, else null. */
    targets: z.array(ActionTarget.nullable()).optional(),
  }),
  z.object({ kind: z.literal("function"), output: z.string() }),
]);
export type CallResult = z.infer<typeof CallResult>;

/** What one model call decided: stored as a decide step's `run_steps.result`. */
export const DecideResult = z.object({
  status: AgentTurnStatus.nullable(),
  calls: z.number().int().nonnegative(),
  /** Absent on rows from before summaries were requested, and when the model gave none. */
  reasoning: ReasoningSummary.optional(),
});
export type DecideResult = z.infer<typeof DecideResult>;

function summarizeAction(action: ComputerAction): string {
  switch (action.type) {
    case "click":
    case "double_click":
    case "move":
      return `${action.type.replace("_", " ")} (${action.x}, ${action.y})`;
    case "drag":
      return `drag ${action.path.length} points`;
    case "scroll":
      return `scroll ${action.scroll_y > 0 ? "down" : action.scroll_y < 0 ? "up" : "sideways"}`;
    case "keypress":
      return `press ${action.keys.join("+")}`.slice(0, 80);
    case "type":
      return `type "${action.text.slice(0, 40)}${action.text.length > 40 ? "…" : ""}"`;
    case "wait":
      return "wait";
    case "screenshot":
      return "look at the screen";
  }
}

/** A computer step's timeline summary (StepAction.summary): its first action, then "(+n more)". */
export function summarizeComputerActions(actions: readonly ComputerAction[]): string {
  const first = actions[0];
  if (!first) return "";
  const more = actions.length > 1 ? ` (+${actions.length - 1} more)` : "";
  return `${summarizeAction(first)}${more}`.slice(0, 300);
}

/**
 * For rows stored without `effects`: whether a summary may hide page input. Strict, since a batch
 * may hide a click behind its first action.
 */
export function summaryMayReachPage(summary: string): boolean {
  return (
    /^(?:click|double click|drag|press|type) /.test(summary) || / \(\+\d+ more\)$/.test(summary)
  );
}
