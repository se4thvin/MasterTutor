import { z } from "zod";
import { ApprovalRequest } from "../approval.ts";
import { Budget, Plan, Usage } from "../budget.ts";
import { MAX_USER_DOWNLOADS_PER_RUN } from "../constants.ts";
import {
  ApprovalKind,
  ApprovalMode,
  ApprovalStatus,
  BenchmarkOutcome,
  Controller,
  Fidelity,
  FiledBy,
  ObserverMode,
  RunStatus,
  SourceKind,
  StepPhase,
  StepState,
  ToolProfile,
  TypedSecretField,
  VaultAuditAction,
  VaultSecretField,
  WaitReason,
} from "../enums.ts";
import { StepAction } from "../events.ts";
import { MAX_BLOCK_CHARS } from "../markdown.ts";
import { NoteBlock } from "../note.ts";
import { RunError } from "../run.ts";
import { secretValueProblem } from "../vault.ts";
import {
  Alias,
  FolderName,
  IsoDate,
  IsoDateTime,
  Origin,
  OriginInput,
  SlotName,
  Uuid,
} from "../primitives.ts";

export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;

export const PageInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).nullable().default(null),
});
export type PageInput = z.infer<typeof PageInput>;

export function Page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

const Count = z.number().int().nonnegative();

/* ---------------------------------- runs ---------------------------------- */

/**
 * Bypass mode (D44) is an explicit opt-in: the request must say it was shown the warning, so no
 * client reaches it by sending the mode alone.
 */
const BypassAcknowledged = z.literal(true).optional();
const bypassNeedsAcknowledgement = (input: {
  approvalMode: string;
  bypassAcknowledged?: true | undefined;
}) => input.approvalMode !== "bypass" || input.bypassAcknowledged === true;
const BYPASS_UNACKNOWLEDGED = {
  message: "Bypass mode needs bypassAcknowledged: true (the user saw the warning)",
  path: ["bypassAcknowledged"],
};

/**
 * Auto mode approves only inside the allowlist and denies every new origin, so a run with no
 * allowed origin could never open a page: it needs at least one.
 */
export const autoModeNeedsOrigins = (input: {
  approvalMode: string;
  allowedOrigins: readonly string[];
}) => input.approvalMode !== "auto_within_allowlist" || input.allowedOrigins.length > 0;

/**
 * A run needs only a goal. Sources and allowed origins are optional: with none, the agent starts
 * on a blank page and every website it opens is a new origin, approved like any other.
 */
export const CreateRunInput = z
  .object({
    goal: z.string().trim().min(1).max(4_000),
    allowedOrigins: z.array(OriginInput).max(50).default([]),
    budget: Budget.optional(),
    targetFolderId: Uuid.nullable().default(null),
    approvalMode: ApprovalMode.default("ask"),
    toolProfile: ToolProfile.default("browser_use"),
    bypassAcknowledged: BypassAcknowledged,
    /** Guard rollout (spec §6.8): shadow records only and must be acknowledged, like bypass. */
    observerMode: ObserverMode.default("enforce"),
    observerShadowAcknowledged: z.literal(true).optional(),
  })
  .refine(bypassNeedsAcknowledgement, BYPASS_UNACKNOWLEDGED)
  .refine((input) => input.observerMode !== "shadow" || input.observerShadowAcknowledged === true, {
    message: "Shadow mode needs observerShadowAcknowledged: true (the user saw the warning)",
    path: ["observerShadowAcknowledged"],
  })
  .refine(autoModeNeedsOrigins, {
    message: "Auto mode needs at least one allowed origin",
    path: ["allowedOrigins"],
  });
export type CreateRunInput = z.infer<typeof CreateRunInput>;

export const ListRunsInput = PageInput.extend({ status: RunStatus.nullable().default(null) });
export type ListRunsInput = z.infer<typeof ListRunsInput>;

export const RunRef = z.object({ runId: Uuid });
export type RunRef = z.infer<typeof RunRef>;

export const RunSummary = z.object({
  id: Uuid,
  goal: z.string(),
  /** runs.title, or fallbackRunTitle(goal) while none is stored. Untrusted: shown as text. */
  title: z.string(),
  status: RunStatus,
  waitReason: WaitReason.nullable(),
  controller: Controller,
  approvalMode: ApprovalMode,
  observerMode: ObserverMode,
  toolProfile: ToolProfile,
  model: z.string(),
  noteId: Uuid.nullable(),
  usage: Usage,
  budget: Budget,
  createdAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const ApprovalView = z.object({
  id: Uuid,
  runId: Uuid,
  stepSeq: Count,
  kind: ApprovalKind,
  request: ApprovalRequest,
  status: ApprovalStatus,
  decidedBy: z.string().nullable(),
  decidedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type ApprovalView = z.infer<typeof ApprovalView>;

/**
 * A download made while a person held control, still waiting for their Keep or Discard (B6 A11).
 * In the snapshot so a reload during control still offers it: the stream resumes past its event.
 */
export const HeldDownloadView = z.object({
  id: Uuid,
  filename: z.string().max(255),
  bytes: z.number().int().nonnegative(),
});
export type HeldDownloadView = z.infer<typeof HeldDownloadView>;

/**
 * A download stored with the run (an approved agent download, or one the person kept at
 * hand-back): what download_ready announced, in the snapshot so a reload lists it again.
 */
export const StoredDownloadView = z.object({
  id: Uuid,
  assetId: Uuid,
  filename: z.string().max(255),
  bytes: z.number().int().nonnegative(),
  at: IsoDateTime,
});
export type StoredDownloadView = z.infer<typeof StoredDownloadView>;

export const RunDetail = RunSummary.extend({
  plan: Plan.nullable(),
  allowedOrigins: z.array(Origin),
  currentUrl: z.string().nullable(),
  slotName: SlotName.nullable(),
  targetFolderId: Uuid.nullable(),
  pendingApprovals: z.array(ApprovalView),
  /** Undecided downloads held while a person has control; empty whenever the agent has it. */
  heldDownloads: z.array(HeldDownloadView),
  /** Why the run failed or stopped, as stored with its terminal status (D35); null otherwise. */
  error: RunError.nullable().default(null),
  /** Stored downloads, oldest first; never a held or discarded one. */
  downloads: z.array(StoredDownloadView),
  lastEventId: z
    .string()
    .regex(/^[0-9]+$/)
    .nullable(),
});
export type RunDetail = z.infer<typeof RunDetail>;

export const ListRunStepsInput = z.object({
  runId: Uuid,
  afterSeq: Count.nullable().default(null),
  limit: z.number().int().min(1).max(500).default(200),
});
export type ListRunStepsInput = z.infer<typeof ListRunStepsInput>;

export const RunStepView = z.object({
  seq: Count,
  phase: StepPhase,
  state: StepState,
  caption: z.string().nullable(),
  url: z.string().nullable(),
  screenshotKey: z.string().nullable(),
  action: StepAction.nullable(),
  createdAt: IsoDateTime,
});
export type RunStepView = z.infer<typeof RunStepView>;

export const SendMessageInput = z.object({
  runId: Uuid,
  text: z.string().trim().min(1).max(4_000),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

/** The code is sealed by web the moment it arrives (spec §9); never logged. */
export const SubmitOtpInput = z.object({ runId: Uuid, code: z.string().regex(/^[0-9]{4,8}$/) });
export type SubmitOtpInput = z.infer<typeof SubmitOtpInput>;

export const HandBackInput = z.object({
  runId: Uuid,
  note: z.string().trim().min(1).max(4_000).nullable().default(null),
  /**
   * The downloads made during control the person keeps (download ids). Every other one is
   * discarded: nothing a person did not explicitly keep is stored or shown to the agent (A11).
   */
  keep: z.array(Uuid).max(MAX_USER_DOWNLOADS_PER_RUN).default([]),
});
export type HandBackInput = z.infer<typeof HandBackInput>;

/* ------------------------------ notes/folders ----------------------------- */

export const NoteRef = z.object({ noteId: Uuid });
export type NoteRef = z.infer<typeof NoteRef>;
export const BlockRef = z.object({ blockId: Uuid });
export type BlockRef = z.infer<typeof BlockRef>;

export const ListNotesInput = PageInput.extend({
  folder: z.union([z.literal("all"), z.literal("unfiled"), Uuid]).default("all"),
  kind: SourceKind.nullable().default(null),
});
export type ListNotesInput = z.infer<typeof ListNotesInput>;

export const NoteSummary = z.object({
  id: Uuid,
  folderId: Uuid.nullable(),
  title: z.string(),
  lede: z.string().nullable(),
  fidelity: Fidelity,
  coverage: z.number().min(0).max(1).nullable(),
  filedBy: FiledBy,
  runId: Uuid.nullable(),
  sourceKinds: z.array(SourceKind),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type NoteSummary = z.infer<typeof NoteSummary>;

export const SourceView = z.object({
  id: Uuid,
  kind: SourceKind,
  url: z.string(),
  canonicalUrl: z.string().nullable(),
  origin: Origin,
  title: z.string().nullable(),
  faviconAssetId: Uuid.nullable(),
  capturedAt: IsoDateTime,
});
export type SourceView = z.infer<typeof SourceView>;

export const NoteDetail = z.object({
  note: NoteSummary,
  blocks: z.array(NoteBlock),
  sources: z.array(SourceView),
});
export type NoteDetail = z.infer<typeof NoteDetail>;

/** "Mark verified": the block, and the note's fidelity as the one rule (noteFidelity) now gives it. */
export const MarkVerifiedResult = z.object({ block: NoteBlock, fidelity: Fidelity });
export type MarkVerifiedResult = z.infer<typeof MarkVerifiedResult>;

/** A person may save any block the agent may store: the one block-size limit (MAX_BLOCK_CHARS). */
export const UpdateBlockInput = z.object({
  blockId: Uuid,
  markdown: z.string().max(MAX_BLOCK_CHARS),
});
export type UpdateBlockInput = z.infer<typeof UpdateBlockInput>;
export const MoveNoteInput = z.object({ noteId: Uuid, folderId: Uuid.nullable() });
export type MoveNoteInput = z.infer<typeof MoveNoteInput>;

export const SearchInput = z.object({
  q: z.string().trim().min(1).max(500),
  kind: SourceKind.nullable().default(null),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchInput = z.infer<typeof SearchInput>;
export const SearchHit = z.object({
  noteId: Uuid,
  blockId: Uuid.nullable(),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
});
export type SearchHit = z.infer<typeof SearchHit>;

/** Obsidian-compatible Markdown + assets/ zip, served by web. */
export const ExportResult = z.object({ downloadUrl: z.string().min(1), expiresAt: IsoDateTime });
export type ExportResult = z.infer<typeof ExportResult>;

export const FolderView = z.object({
  id: Uuid,
  parentId: Uuid.nullable(),
  name: z.string(),
  sort: z.number().int(),
});
export type FolderView = z.infer<typeof FolderView>;
export const FolderRef = z.object({ folderId: Uuid });
export type FolderRef = z.infer<typeof FolderRef>;
export const CreateFolderInput = z.object({
  name: FolderName,
  parentId: Uuid.nullable().default(null),
});
export type CreateFolderInput = z.infer<typeof CreateFolderInput>;
export const RenameFolderInput = z.object({ folderId: Uuid, name: FolderName });
export type RenameFolderInput = z.infer<typeof RenameFolderInput>;
export const MoveFolderInput = z.object({ folderId: Uuid, parentId: Uuid.nullable() });
export type MoveFolderInput = z.infer<typeof MoveFolderInput>;

/* ---------------------------------- vault --------------------------------- */

/** The IMAP password is a sealed vault field (imap_password), never part of this object. */
export const ImapConfig = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  user: z.string().min(1).max(320),
  senderFilter: z.string().min(1).max(320),
});
export type ImapConfig = z.infer<typeof ImapConfig>;

export const VaultItemView = z.object({
  id: Uuid,
  alias: Alias,
  origin: Origin,
  label: z.string(),
  fields: z.array(VaultSecretField),
  hasImap: z.boolean(),
  sessionSaved: z.boolean(),
  createdAt: IsoDateTime,
});
export type VaultItemView = z.infer<typeof VaultItemView>;

const SecretValue = z.string().min(1).max(4_096);
export const CreateVaultItemInput = z
  .object({
    alias: Alias,
    origin: OriginInput,
    label: z.string().trim().min(1).max(120),
    secrets: z.partialRecord(TypedSecretField, SecretValue),
    imap: ImapConfig.nullable().default(null),
  })
  .superRefine((input, ctx) => {
    for (const field of TypedSecretField.options) {
      const value = input.secrets[field];
      const problem = value === undefined ? null : secretValueProblem(field, value);
      if (problem) ctx.addIssue({ code: "custom", path: ["secrets", field], message: problem });
    }
    if (input.secrets.imap_password !== undefined && input.imap === null)
      ctx.addIssue({
        code: "custom",
        path: ["imap"],
        message: "An email-code password needs mail settings.",
      });
  });
export type CreateVaultItemInput = z.infer<typeof CreateVaultItemInput>;
export const VaultItemRef = z.object({ itemId: Uuid });
export type VaultItemRef = z.infer<typeof VaultItemRef>;
export const SetSecretInput = z
  .object({
    itemId: Uuid,
    field: TypedSecretField,
    value: SecretValue,
  })
  .superRefine((input, ctx) => {
    const problem = secretValueProblem(input.field, input.value);
    if (problem) ctx.addIssue({ code: "custom", path: ["value"], message: problem });
  });
export type SetSecretInput = z.infer<typeof SetSecretInput>;
export const RemoveSecretInput = z.object({ itemId: Uuid, field: VaultSecretField });
export type RemoveSecretInput = z.infer<typeof RemoveSecretInput>;
export const ForgetSessionInput = z.object({ alias: Alias, origin: OriginInput });
export type ForgetSessionInput = z.infer<typeof ForgetSessionInput>;

export const VaultAuditView = z.object({
  id: Uuid,
  alias: z.string(),
  origin: z.string().nullable(),
  field: z.string().nullable(),
  action: VaultAuditAction,
  runId: Uuid.nullable(),
  approvedBy: z.string().nullable(),
  outcome: z.string(),
  at: IsoDateTime,
});
export type VaultAuditView = z.infer<typeof VaultAuditView>;

/* -------------------------------- settings -------------------------------- */

/**
 * Optimistic concurrency for the defaults (D14, R29-5): opaque to clients, compared exactly by the
 * server. It changes when the defaults or concurrency change, never on a kill-switch toggle.
 */
export const SettingsVersion = z.string().min(1).max(64);
export type SettingsVersion = z.infer<typeof SettingsVersion>;

export const SettingsView = z.object({
  killSwitch: z.boolean(),
  defaultBudget: Budget,
  defaultAllowedOrigins: z.array(Origin),
  concurrency: z.number().int().min(1),
  version: SettingsVersion,
});
export type SettingsView = z.infer<typeof SettingsView>;
export const UpdateSettingsInput = z.object({
  /** The version the client last read; a stale one is CONFLICT. */
  version: SettingsVersion,
  defaultBudget: Budget.optional(),
  defaultAllowedOrigins: z.array(OriginInput).max(50).optional(),
  concurrency: z.number().int().min(1).max(64).optional(),
});
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInput>;
export const SetKillSwitchInput = z.object({ on: z.boolean() });
export type SetKillSwitchInput = z.infer<typeof SetKillSwitchInput>;

/** The longest usage range, both ends included (D52: perDay is dense, one entry per day). */
export const USAGE_MAX_DAYS = 400;
/** perRun lists at most this many runs of the range, newest first. */
export const USAGE_MAX_RUNS = 500;
const DAY_MS = 86_400_000;
export const UsageInput = z
  .object({ from: IsoDate, to: IsoDate })
  .refine((range) => range.from <= range.to, { message: "from must not be after to" })
  .refine(
    (range) => (Date.parse(range.to) - Date.parse(range.from)) / DAY_MS + 1 <= USAGE_MAX_DAYS,
    { message: `A usage range covers at most ${USAGE_MAX_DAYS} days` },
  );
export type UsageInput = z.infer<typeof UsageInput>;
export const UsageReport = z.object({
  perDay: z.array(z.object({ day: IsoDate, runs: Count, usd: z.number(), steps: Count })),
  perRun: z.array(
    z.object({ runId: Uuid, title: z.string(), status: RunStatus, usd: z.number(), steps: Count }),
  ),
  stepLatencyMs: z.object({ p50: z.number().nullable(), p95: z.number().nullable() }),
  openaiErrorRate: z.number().min(0).max(1).nullable(),
});
export type UsageReport = z.infer<typeof UsageReport>;

/* --------------------------------- assets --------------------------------- */

export const AssetRef = z.object({ assetId: Uuid });
export type AssetRef = z.infer<typeof AssetRef>;
export const SignedUrl = z.object({ url: z.string().min(1), expiresAt: IsoDateTime });
export type SignedUrl = z.infer<typeof SignedUrl>;

/* ------------------------------- benchmarks ------------------------------- */

export const BenchmarkView = z.object({
  id: Uuid,
  name: z.string(),
  task: z.string(),
  allowedOrigins: z.array(Origin),
  approvalMode: ApprovalMode,
  toolProfile: ToolProfile,
  budget: Budget,
  successCriteria: z.string(),
  createdAt: IsoDateTime,
});
export type BenchmarkView = z.infer<typeof BenchmarkView>;
export const CreateBenchmarkInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    task: z.string().trim().min(1).max(4_000),
    allowedOrigins: z.array(OriginInput).min(1).max(50),
    approvalMode: ApprovalMode.default("auto_within_allowlist"),
    bypassAcknowledged: BypassAcknowledged,
    toolProfile: ToolProfile.default("browser_use"),
    budget: Budget.optional(),
    successCriteria: z.string().trim().min(1).max(4_000),
  })
  .refine(bypassNeedsAcknowledgement, BYPASS_UNACKNOWLEDGED);
export type CreateBenchmarkInput = z.infer<typeof CreateBenchmarkInput>;
export const BenchmarkRef = z.object({ benchmarkId: Uuid });
export type BenchmarkRef = z.infer<typeof BenchmarkRef>;
export const StartBenchmarkResult = z.object({ benchmarkRunId: Uuid, runId: Uuid });
export type StartBenchmarkResult = z.infer<typeof StartBenchmarkResult>;
export const ListBenchmarkRunsInput = z.object({
  benchmarkId: Uuid.nullable().default(null),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListBenchmarkRunsInput = z.infer<typeof ListBenchmarkRunsInput>;
export const BenchmarkRunView = z.object({
  id: Uuid,
  benchmarkId: Uuid,
  runId: Uuid.nullable(),
  outcome: BenchmarkOutcome,
  steps: Count,
  usd: z.number().nonnegative(),
  inputTokens: Count,
  outputTokens: Count,
  durationMs: Count.nullable(),
  takeovers: Count,
  failureNotes: z.string().nullable(),
  gradedBy: z.string().nullable(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
});
export type BenchmarkRunView = z.infer<typeof BenchmarkRunView>;
export const GradeBenchmarkRunInput = z.object({
  benchmarkRunId: Uuid,
  outcome: BenchmarkOutcome.exclude(["pending"]),
  failureNotes: z.string().trim().max(10_000).nullable().default(null),
});
export type GradeBenchmarkRunInput = z.infer<typeof GradeBenchmarkRunInput>;
