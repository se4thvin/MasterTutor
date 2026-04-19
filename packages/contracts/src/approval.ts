import { z } from "zod";
import { Budget, Usage } from "./budget.ts";
import type { ApprovalKind, ApprovalMode } from "./enums.ts";
import { Alias, Origin, Uuid } from "./primitives.ts";
import { ComputerAction } from "./tools.ts";

/** Spec §5.5 risky words, matched as word prefixes so "payment" and "deleting" are caught. */
export const RISKY_ACTION =
  /\b(?:buy|pay|order|check\s?out|delet|remov|send|post|publish|submit|confirm|subscrib|unsubscrib|transfer)\w*/iu;

/** NFKC folds full-width letters; format characters (zero-width) are stripped first. */
export function isRiskyLabel(label: string): boolean {
  return RISKY_ACTION.test(label.normalize("NFKC").replace(/\p{Cf}/gu, ""));
}

const PageUrl = z.string().min(1).max(4_096);
const ScreenshotKey = z.string().min(1).max(1_024).nullable();
const RecordExcerpt = z.string().max(240).nullable().optional();

export const ApprovalRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("risky_click"),
    action: ComputerAction,
    label: z.string().max(500),
    url: PageUrl,
    screenshotKey: ScreenshotKey,
    /** Present when the request is the model's pending_safety_checks, not a risky target. */
    safetyChecks: z
      .array(
        z.object({ code: z.string().max(100).nullable(), message: z.string().max(500).nullable() }),
      )
      .max(20)
      .optional(),
    /** The record the action targets (R29-3), cleaned and capped; for the approval card only, never the model. */
    context: RecordExcerpt,
  }),
  z.object({
    kind: z.literal("form_submit"),
    /** What triggers the submit (a click, Enter, a line break typed into a field). */
    action: ComputerAction.optional(),
    url: PageUrl,
    formSummary: z.string().max(1_000),
    screenshotKey: ScreenshotKey,
    context: RecordExcerpt,
  }),
  z.object({ kind: z.literal("download"), url: PageUrl, filename: z.string().max(255).nullable() }),
  z.object({
    kind: z.literal("credential_first_use"),
    alias: Alias,
    origin: Origin,
    /** Set when the target form posts elsewhere: where it would send the credential. */
    postsTo: z.string().max(4_096).optional(),
  }),
  z.object({ kind: z.literal("new_origin"), origin: Origin, url: PageUrl }),
  z.object({
    kind: z.literal("budget"),
    exceeded: z.enum(["steps", "usd", "minutes"]),
    usage: Usage,
    budget: Budget,
  }),
]);
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/** Budget sheet: Extend +50% / Finish now (Cancel is a denial). */
export const BUDGET_CHOICES = ["extend", "finish_now"] as const;
export const BudgetChoice = z.enum(BUDGET_CHOICES);
export type BudgetChoice = z.infer<typeof BudgetChoice>;

/** Stored in approvals.edit. */
export const ApprovalEdit = z.object({
  instruction: z.string().max(2_000).nullable(),
  budgetChoice: BudgetChoice.nullable(),
});
export type ApprovalEdit = z.infer<typeof ApprovalEdit>;

export const APPROVAL_DECISIONS = ["approved", "denied", "edited"] as const;
export const ApprovalDecision = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalDecisionInput = z
  .object({
    approvalId: Uuid,
    decision: ApprovalDecision,
    instruction: z.string().trim().min(1).max(2_000).nullable().default(null),
    budgetChoice: BudgetChoice.nullable().default(null),
  })
  .superRefine((input, ctx) => {
    if (input.decision === "edited" && input.instruction === null) {
      ctx.addIssue({
        code: "custom",
        path: ["instruction"],
        message: "An edit needs an instruction",
      });
    }
  });
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInput>;

export type PolicyDecision = "approved" | "denied" | "ask";

/**
 * Benchmark mode (approvalMode = auto_within_allowlist). Every decision is still written to
 * `approvals` with decided_by = POLICY_DECIDER. New origins and downloads stay blocked;
 * budget hits still wait for a human, so auto mode never spends beyond the budget.
 */
export const AUTO_MODE_DECISIONS = {
  risky_click: "approved",
  form_submit: "approved",
  download: "denied",
  credential_first_use: "approved",
  new_origin: "denied",
  budget: "ask",
} as const satisfies Record<ApprovalKind, PolicyDecision>;

/**
 * Bypass mode (D44): every action approval is approved without asking: risky clicks and keys,
 * submits, uninspectable frames, first credential use, new origins and downloads. A budget hit
 * still waits for a person (a spending cap, not an action). Bypass never lifts the hard
 * invariants: a prompt-injection safety check still waits for a person (decideSafetyChecks); a
 * bypass decision is never a person's (vault fills stay on the item's exact origin, an off-origin
 * form still needs a person, no lasting vault grant); the network policy, sandbox, kill switch,
 * takeover and secret masking do not depend on the approval mode at all.
 */
export const BYPASS_DECISIONS = {
  risky_click: "approved",
  form_submit: "approved",
  download: "approved",
  credential_first_use: "approved",
  new_origin: "approved",
  budget: "ask",
} as const satisfies Record<ApprovalKind, PolicyDecision>;

export const POLICY_DECIDER = "policy";
/** decided_by of a decision bypass mode made (D44). */
export const BYPASS_DECIDER = "bypass";

/** Who the policy decides as in this mode: recorded in approvals.decided_by. */
export function policyDecider(mode: ApprovalMode): string {
  return mode === "bypass" ? BYPASS_DECIDER : POLICY_DECIDER;
}

/** A decision made by a person (a user id), not by the auto or bypass policy. */
export function isPersonDecider(decidedBy: string | null): boolean {
  return decidedBy !== null && decidedBy !== POLICY_DECIDER && decidedBy !== BYPASS_DECIDER;
}

export function decideByPolicy(mode: ApprovalMode, kind: ApprovalKind): PolicyDecision {
  if (mode === "bypass") return BYPASS_DECISIONS[kind];
  return mode === "ask" ? "ask" : AUTO_MODE_DECISIONS[kind];
}

/** The only safety-check code auto mode may clear, and only on an allowed origin. */
export const AUTO_CLEARABLE_SAFETY_CHECK = "irrelevant_domain";

/** Safety-check codes bypass mode clears (D44); anything else, prompt injection first, waits. */
export const BYPASS_CLEARABLE_SAFETY_CHECKS: readonly string[] = [
  "irrelevant_domain",
  "sensitive_domain",
];

/**
 * The model's pending_safety_checks have their own rule (not AUTO_MODE_DECISIONS): prompt-injection
 * signals (malicious_instructions), sensitive domains and unknown codes always wait for a human.
 * Bypass clears only BYPASS_CLEARABLE_SAFETY_CHECKS: malicious_instructions always waits.
 */
export function decideSafetyChecks(
  mode: ApprovalMode,
  checks: ReadonlyArray<{ code: string | null }>,
  originAllowed: boolean,
): PolicyDecision {
  if (mode === "bypass")
    return checks.length > 0 &&
      checks.every(
        (check) => check.code !== null && BYPASS_CLEARABLE_SAFETY_CHECKS.includes(check.code),
      )
      ? "approved"
      : "ask";
  if (mode === "ask" || !originAllowed || checks.length === 0) return "ask";
  return checks.every((check) => check.code === AUTO_CLEARABLE_SAFETY_CHECK) ? "approved" : "ask";
}
