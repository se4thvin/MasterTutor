import {
  type CaptureBrief,
  type CaptureQuestion,
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  MODELS,
  SLOT_NAME_PATTERN,
  deciderShapeSql,
  type ApprovalEdit,
  type Decider,
  type ApprovalRequest,
  type Budget,
  type GuardState,
  type Plan,
  type RunError,
  type RunEvent,
  type ScrollPosition,
  type Usage,
} from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, jsonbDefault, tstz, updatedAt } from "./columns.ts";
import {
  approvalKindEnum,
  approvalModeEnum,
  approvalStatusEnum,
  controllerEnum,
  observerModeEnum,
  runStatusEnum,
  slotStateEnum,
  stepPhaseEnum,
  stepStateEnum,
  toolProfileEnum,
  waitReasonEnum,
} from "./enums.ts";
import { assets, folders, notes } from "./library.ts";
import { workspaces } from "./workspace.ts";

/** One row per Compose slot; rows are synced from BROWSER_SLOTS by migrate. */
export const browserSlots = pgTable(
  "browser_slots",
  {
    name: text("name").primaryKey(),
    state: slotStateEnum("state").notNull().default("restarting"),
    runId: uuid("run_id").references((): AnyPgColumn => runs.id, { onDelete: "set null" }),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: tstz("lease_expires_at"),
    restartedAt: tstz("restarted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("browser_slots_run_uq").on(t.runId),
    check("browser_slots_name_valid", sql`${t.name} ~ ${sql.raw(`'${SLOT_NAME_PATTERN.source}'`)}`),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(),
    /** The generated short title, written once by the agent; null shows fallbackRunTitle(goal). */
    title: text("title"),
    status: runStatusEnum("status").notNull().default("queued"),
    waitReason: waitReasonEnum("wait_reason"),
    controller: controllerEnum("controller").notNull().default("agent"),
    /** Better Auth user id of the member holding control; set iff controller = 'user' (B6, F8). */
    controlUserId: text("control_user_id"),
    /** Who last opened the live view (openLive): their open n.eko session is closed on sign-out. */
    liveViewerId: text("live_viewer_id"),
    approvalMode: approvalModeEnum("approval_mode").notNull().default("ask"),
    /** Guard rollout (D52, spec §6.8): shadow records only. */
    observerMode: observerModeEnum("observer_mode").notNull().default("shadow"),
    /** Agent-only durable trigger and watcher checkpoint. */
    guardState: jsonb("guard_state").$type<GuardState>(),
    toolProfile: toolProfileEnum("tool_profile").notNull().default("browser_use"),
    model: text("model").notNull().default(MODELS.agentPrimary),
    previousResponseId: text("previous_response_id"),
    plan: jsonb("plan").$type<Plan>(),
    captureBrief: jsonb("capture_brief").$type<CaptureBrief>(),
    captureQuestion: jsonb("capture_question").$type<CaptureQuestion>(),
    budget: jsonb("budget").$type<Budget>().notNull().default(jsonbDefault(DEFAULT_BUDGET)),
    usage: jsonb("usage").$type<Usage>().notNull().default(jsonbDefault(EMPTY_USAGE)),
    allowedOrigins: text("allowed_origins").array().notNull(),
    targetFolderId: uuid("target_folder_id").references(() => folders.id, { onDelete: "set null" }),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    slotName: text("slot_name").references((): AnyPgColumn => browserSlots.name, {
      onDelete: "set null",
    }),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: tstz("lease_expires_at"),
    wakeRequestedAt: tstz("wake_requested_at"),
    lastActivityAt: tstz("last_activity_at"),
    currentUrl: text("current_url"),
    scroll: jsonb("scroll").$type<ScrollPosition>(),
    videoTime: doublePrecision("video_time"),
    error: jsonb("error").$type<RunError>(),
    finishedAt: tstz("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("runs_claim_idx").on(t.status, t.leaseExpiresAt),
    index("runs_workspace_created_idx").on(t.workspaceId, t.createdAt),
    unique("runs_slot_name_uq").on(t.slotName),
    check(
      "runs_wait_reason_matches_status",
      sql`(${t.status} = 'waiting') = (${t.waitReason} is not null)`,
    ),
    check(
      "runs_control_user_matches_controller",
      sql`(${t.controller} = 'user') = (${t.controlUserId} is not null)`,
    ),
  ],
);

export const runRef = () =>
  uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" });

export const runSteps = pgTable(
  "run_steps",
  {
    id: id(),
    runId: runRef(),
    seq: integer("seq").notNull(),
    phase: stepPhaseEnum("phase").notNull(),
    state: stepStateEnum("state").notNull(),
    action: jsonb("action").$type<unknown>(),
    result: jsonb("result").$type<unknown>(),
    caption: text("caption"),
    url: text("url"),
    screenshotKey: text("screenshot_key"),
    usage: jsonb("usage").$type<Usage>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("run_steps_run_seq_uq").on(t.runId, t.seq)],
);

export const runTranscript = pgTable(
  "run_transcript",
  {
    id: id(),
    runId: runRef(),
    seq: integer("seq").notNull(),
    item: jsonb("item").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("run_transcript_run_seq_uq").on(t.runId, t.seq)],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: runRef(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<RunEvent>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("run_events_run_id_idx").on(t.runId, t.id)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    runId: runRef(),
    stepSeq: integer("step_seq").notNull(),
    kind: approvalKindEnum("kind").notNull(),
    request: jsonb("request").$type<ApprovalRequest>().notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    edit: jsonb("edit").$type<ApprovalEdit>(),
    /** A user id or a machine decider (MACHINE_DECIDERS, spec §4). */
    decidedBy: text("decided_by").$type<Decider>(),
    decidedAt: tstz("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("approvals_run_status_idx").on(t.runId, t.status),
    // Input validation at the trust boundary (spec §4): a user id or a machine decider, nothing else.
    check("approvals_decided_by_ck", sql.raw(deciderShapeSql(`"approvals"."decided_by"`))),
  ],
);

export const downloads = pgTable("downloads", {
  id: id(),
  runId: runRef(),
  filename: text("filename").notNull(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  approvedBy: text("approved_by").notNull(),
  /**
   * Made while a person held control (B6): held locally, not stored, until they keep it at
   * hand-back (kept_at) and the agent files it; undecided ones are discarded.
   */
  pending: boolean("pending").notNull().default(false),
  keptAt: tstz("kept_at"),
  /** Made by the person in control (not an approved agent download): counts toward their cap. */
  byUser: boolean("by_user").notNull().default(false),
  /** Not kept: the row stays (never an asset) so a discard does not free quota within the run. */
  discardedAt: tstz("discarded_at"),
  createdAt: createdAt(),
});
