import { z } from "zod";

export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "sleeping",
  "completed",
  "failed",
  "cancelled",
] as const;
export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;
export const TERMINAL_RUN_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly RunStatus[];

export const WAIT_REASONS = ["approval", "takeover", "captcha", "otp"] as const;
export const WaitReason = z.enum(WAIT_REASONS);
export type WaitReason = z.infer<typeof WaitReason>;
/**
 * Waits a takeover leaves on the run row (B3 M7/F1): the person may type the code or solve the
 * CAPTCHA themselves, and hand-back re-observes. Shared by the web's takeover write and the agent.
 */
export const WAITS_KEPT_THROUGH_TAKEOVER: readonly WaitReason[] = ["otp", "captcha"];

export const CONTROLLERS = ["agent", "user"] as const;
export const Controller = z.enum(CONTROLLERS);
export type Controller = z.infer<typeof Controller>;

/**
 * ask: a person decides. auto_within_allowlist (benchmark): the policy decides, records every
 * decision (decided_by='policy') and still blocks new origins and downloads. bypass (D44, explicit
 * per-run opt-in): the policy approves every action approval (decided_by='bypass'); the hard
 * invariants still hold (see BYPASS_DECISIONS).
 */
export const APPROVAL_MODES = ["ask", "auto_within_allowlist", "bypass"] as const;
export const ApprovalMode = z.enum(APPROVAL_MODES);
export type ApprovalMode = z.infer<typeof ApprovalMode>;

export const STEP_PHASES = ["observe", "decide", "approve", "act"] as const;
export const StepPhase = z.enum(STEP_PHASES);
export type StepPhase = z.infer<typeof StepPhase>;

export const STEP_STATES = ["started", "done", "skipped", "aborted"] as const;
export const StepState = z.enum(STEP_STATES);
export type StepState = z.infer<typeof StepState>;

export const APPROVAL_KINDS = [
  "risky_click",
  "form_submit",
  "download",
  "credential_first_use",
  "new_origin",
  "budget",
] as const;
export const ApprovalKind = z.enum(APPROVAL_KINDS);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const APPROVAL_STATUSES = ["pending", "approved", "denied", "edited", "superseded"] as const;
export const ApprovalStatus = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const SOURCE_KINDS = ["web", "pdf", "youtube"] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const FILED_BY = ["agent", "user"] as const;
export const FiledBy = z.enum(FILED_BY);
export type FiledBy = z.infer<typeof FiledBy>;

export const FIDELITIES = ["verified", "partial", "needs_review"] as const;
export const Fidelity = z.enum(FIDELITIES);
export type Fidelity = z.infer<typeof Fidelity>;

export const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "quote",
  "code",
  "table",
  "math",
  "image",
  "figure",
  "transcript",
  "keyframe",
  "commentary",
] as const;
export const BlockType = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof BlockType>;

export const BLOCK_ORIGINS = [
  "dom",
  "pdf",
  "captions",
  "asr",
  "ocr_model",
  "model",
  "user",
] as const;
export const BlockOrigin = z.enum(BLOCK_ORIGINS);
export type BlockOrigin = z.infer<typeof BlockOrigin>;

export const MEMBER_ROLES = ["owner", "member"] as const;
export const MemberRole = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof MemberRole>;

export const VAULT_SECRET_FIELDS = [
  "username",
  "password",
  "totp",
  "pin",
  "imap_password",
  "passkey",
] as const;
export const VaultSecretField = z.enum(VAULT_SECRET_FIELDS);
export type VaultSecretField = z.infer<typeof VaultSecretField>;

/** Secret fields a user can type into the vault UI (passkeys are enrolled during takeover). */
export const TYPED_SECRET_FIELDS = [
  "username",
  "password",
  "totp",
  "pin",
  "imap_password",
] as const satisfies readonly VaultSecretField[];
export const TypedSecretField = z.enum(TYPED_SECRET_FIELDS);
export type TypedSecretField = z.infer<typeof TypedSecretField>;

export const CREDENTIAL_FIELDS = ["username", "password", "totp", "pin", "otp"] as const;
export const CredentialField = z.enum(CREDENTIAL_FIELDS);
export type CredentialField = z.infer<typeof CredentialField>;

export const VAULT_AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "fill",
  "passkey",
  "otp_received",
  "denied",
] as const;
export const VaultAuditAction = z.enum(VAULT_AUDIT_ACTIONS);
export type VaultAuditAction = z.infer<typeof VaultAuditAction>;

export const SLOT_STATES = ["idle", "leased", "restarting"] as const;
export const SlotState = z.enum(SLOT_STATES);
export type SlotState = z.infer<typeof SlotState>;

/** A queued run may lease a slot only if another idle slot remains; a wake may take the last one. */
export const LEASE_PRIORITIES = ["wake", "queued"] as const;
export const LeasePriority = z.enum(LEASE_PRIORITIES);
export type LeasePriority = z.infer<typeof LeasePriority>;

export const WAKE_REASONS = ["approval", "otp", "message", "takeover", "resume", "kill"] as const;
export const WakeReason = z.enum(WAKE_REASONS);
export type WakeReason = z.infer<typeof WakeReason>;

export const BENCHMARK_OUTCOMES = ["pending", "passed", "partial", "failed", "error"] as const;
export const BenchmarkOutcome = z.enum(BENCHMARK_OUTCOMES);
export type BenchmarkOutcome = z.infer<typeof BenchmarkOutcome>;

export const ANNOTATE_KINDS = ["summary", "commentary", "heading"] as const;
export const AnnotateKind = z.enum(ANNOTATE_KINDS);
export type AnnotateKind = z.infer<typeof AnnotateKind>;

export const VIDEO_OPS = ["captions", "chapters", "keyframes", "transcribe"] as const;
export const VideoOp = z.enum(VIDEO_OPS);
export type VideoOp = z.infer<typeof VideoOp>;

export const NEED_HUMAN_REASONS = ["captcha", "takeover"] as const;
export const NeedHuman = z.enum(NEED_HUMAN_REASONS);
export type NeedHuman = z.infer<typeof NeedHuman>;

export const AGENT_TURN_STATUSES = ["continue", "done", "need_human"] as const;
export const AgentTurnStatus = z.enum(AGENT_TURN_STATUSES);
export type AgentTurnStatus = z.infer<typeof AgentTurnStatus>;
