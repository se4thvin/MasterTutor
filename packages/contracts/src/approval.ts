import { z } from "zod";
import { Budget, Usage } from "./budget.ts";
import type { ApprovalKind, ApprovalMode } from "./enums.ts";
import { GuardCategory } from "./observer.ts";
import { OBSERVER_ROLES } from "./telemetry.ts";
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
/** A credential_first_use card names every off-origin destination of the form, up to this length. */
export const MAX_POSTS_TO_CHARS = 4_096;
const ScreenshotKey = z.string().min(1).max(1_024).nullable();
const RecordExcerpt = z.string().max(240).nullable().optional();

export const ApprovalSubject = z.discriminatedUnion("kind", [
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
    postsTo: z.string().max(MAX_POSTS_TO_CHARS).optional(),
  }),
  z.object({
    kind: z.literal("new_origin"),
    origin: Origin,
    url: PageUrl,
    /** The page posted a form there: approving lets the action run again; the URL is not opened. */
    formPost: z.literal(true).optional(),
  }),
  z.object({
    kind: z.literal("budget"),
    exceeded: z.enum(["steps", "usd", "minutes"]),
    usage: Usage,
    budget: Budget,
  }),
  /** Typed text read on one origin, going to another outside the allowlist (spec §6.3). */
  z.object({
    kind: z.literal("data_egress"),
    action: ComputerAction,
    url: PageUrl,
    fromOrigin: Origin,
    toOrigin: Origin,
    chars: z.number().int().min(0).max(100_000),
    screenshotKey: ScreenshotKey,
  }),
]);
export type ApprovalSubject = z.infer<typeof ApprovalSubject>;
export type DataEgressRequest = Extract<ApprovalSubject, { kind: "data_egress" }>;

/**
 * The Guard stopped an action (escalate, or block in ask mode) or holds the run (subject null).
 * The rationale is model output: shown as untrusted text on the card only (spec §6.10).
 */
export const ObserverRequest = z.object({
  kind: z.literal("observer"),
  verdict: z.enum(["escalate", "block"]),
  category: GuardCategory,
  rationale: z.string().max(300),
  subject: ApprovalSubject.nullable(),
  url: PageUrl,
  screenshotKey: ScreenshotKey,
});
export type ObserverRequest = z.infer<typeof ObserverRequest>;

export const ApprovalRequest = z.discriminatedUnion("kind", [
  ...ApprovalSubject.options,
  ObserverRequest,
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
  data_egress: "ask",
  observer: "ask",
} as const satisfies Record<ApprovalKind, PolicyDecision>;

/**
 * Bypass mode (D44): every action approval is approved without asking: risky clicks and keys,
 * submits, uninspectable frames, first credential use, new origins and downloads. A budget hit
 * still waits for a person (a spending cap, not an action). Bypass never lifts the hard
 * invariants: a prompt-injection safety check still waits for a person (decideSafetyChecks); a
 * bypass decision is never a person's (vault fills stay on the item's exact origin, an off-origin
 * form still needs a person, no lasting vault grant); the network policy, sandbox, kill switch,
 * takeover and secret masking do not depend on the approval mode at all. `data_egress` is approved
 * (D52, user decision). An `observer` request always waits for a person.
 */
export const BYPASS_DECISIONS = {
  risky_click: "approved",
  form_submit: "approved",
  download: "approved",
  credential_first_use: "approved",
  new_origin: "approved",
  budget: "ask",
  data_egress: "approved",
  observer: "ask",
} as const satisfies Record<ApprovalKind, PolicyDecision>;

export const POLICY_DECIDER = "policy";
/** decided_by of a decision bypass mode made (D44). */
export const BYPASS_DECIDER = "bypass";
/** decided_by of a Guard block (D52). Never a person: see isPersonDecider. */
export const OBSERVER_DECIDER = "observer";
/** decided_by of an approval the loop superseded (the page changed, or a takeover). */
export const AGENT_DECIDER = "agent";

/**
 * Every decider that is not a person: the one closed list (D52 prerequisite, spec §4). A new
 * machine decider is added here or cannot be written (Decider is the write type), so it can never
 * inherit a person's powers (lasting vault grants, off-origin fills, unguarded typing).
 */
export const MACHINE_DECIDERS = [
  POLICY_DECIDER,
  BYPASS_DECIDER,
  OBSERVER_DECIDER,
  AGENT_DECIDER,
] as const;
export type MachineDecider = (typeof MACHINE_DECIDERS)[number];
const MACHINE: ReadonlySet<string> = new Set(MACHINE_DECIDERS);

/**
 * Names no person's id may take, in any letter case: every machine decider plus every Observer role
 * (D52), so a role can never be written, or read back, as a person's decision.
 */
export const RESERVED_DECIDERS = [...MACHINE_DECIDERS, ...OBSERVER_ROLES] as const;
const RESERVED: ReadonlySet<string> = new Set(RESERVED_DECIDERS);

/**
 * The shape of a user id: Better Auth ids (32 alphanumerics) and test ids (user-1, fixture-user).
 * The SQL CHECKs use this exact source (personDeciderSql, deciderShapeSql).
 */
export const PERSON_ID_SOURCE = "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$";
const PERSON_ID = new RegExp(PERSON_ID_SOURCE);

/** A person's decision: a user id, never a machine decider in any letter case. */
export const PersonDecider = z
  .string()
  .regex(PERSON_ID)
  .refine((value) => !RESERVED.has(value.toLowerCase()), "A reserved decider is not a person")
  .brand<"PersonDecider">();
export type PersonDecider = z.infer<typeof PersonDecider>;
/** What approvals.decided_by may be written as. */
export type Decider = MachineDecider | PersonDecider;

export function isMachineDecider(value: string | null | undefined): value is MachineDecider {
  return typeof value === "string" && MACHINE.has(value);
}

/** Who the policy decides as in this mode: recorded in approvals.decided_by. */
export function policyDecider(mode: ApprovalMode): MachineDecider {
  return mode === "bypass" ? BYPASS_DECIDER : POLICY_DECIDER;
}

/** Allow-check (spec §4): true only for a user id. Unknown strings are not people. */
export function isPersonDecider(decidedBy: string | null | undefined): decidedBy is PersonDecider {
  return typeof decidedBy === "string" && PersonDecider.safeParse(decidedBy).success;
}

export type DeciderClass = MachineDecider | "person" | "unknown";

/** The class of a decider for display and telemetry: never the user id itself. */
export function deciderClass(decidedBy: string | null | undefined): DeciderClass {
  if (isMachineDecider(decidedBy)) return decidedBy;
  return isPersonDecider(decidedBy) ? "person" : "unknown";
}

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** SQL: `column` holds a person's id (vault grants). Built from the constants above (one source). */
export function personDeciderSql(column: string): string {
  return `${column} ~ '${PERSON_ID_SOURCE}' AND lower(${column}) NOT IN (${quoted(RESERVED_DECIDERS)})`;
}

/** SQL: `column` is empty or shaped like a decider (approvals.decided_by input validation). */
export function deciderShapeSql(column: string): string {
  return `${column} IS NULL OR ${column} ~ '${PERSON_ID_SOURCE}'`;
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
