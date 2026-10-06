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

export const ApprovalRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("risky_click"),
    action: ComputerAction,
    label: z.string().max(500),
    url: PageUrl,
    screenshotKey: ScreenshotKey,
  }),
  z.object({
    kind: z.literal("form_submit"),
    url: PageUrl,
    formSummary: z.string().max(1_000),
    screenshotKey: ScreenshotKey,
  }),
  z.object({ kind: z.literal("download"), url: PageUrl, filename: z.string().max(255).nullable() }),
  z.object({ kind: z.literal("credential_first_use"), alias: Alias, origin: Origin }),
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

export const POLICY_DECIDER = "policy";

export function decideByPolicy(mode: ApprovalMode, kind: ApprovalKind): PolicyDecision {
  return mode === "ask" ? "ask" : AUTO_MODE_DECISIONS[kind];
}
