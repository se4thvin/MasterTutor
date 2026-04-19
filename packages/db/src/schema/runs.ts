import {
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  MODELS,
  SLOT_NAME_PATTERN,
  type ApprovalEdit,
  type ApprovalRequest,
  type Budget,
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
  runStatusEnum,
  slotStateEnum,
  stepPhaseEnum,
  stepStateEnum,
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
    status: runStatusEnum("status").notNull().default("queued"),
    waitReason: waitReasonEnum("wait_reason"),
    controller: controllerEnum("controller").notNull().default("agent"),
    /** Better Auth user id of the member holding control; set iff controller = 'user' (B6, F8). */
    controlUserId: text("control_user_id"),
    approvalMode: approvalModeEnum("approval_mode").notNull().default("ask"),
    model: text("model").notNull().default(MODELS.agentPrimary),
    previousResponseId: text("previous_response_id"),
    plan: jsonb("plan").$type<Plan>(),
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

const runRef = () =>
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
    /** A user id, or "policy" when approvalMode decided it. */
    decidedBy: text("decided_by"),
    decidedAt: tstz("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_run_status_idx").on(t.runId, t.status)],
);

export const downloads = pgTable("downloads", {
  id: id(),
  runId: runRef(),
  filename: text("filename").notNull(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  approvedBy: text("approved_by").notNull(),
  createdAt: createdAt(),
});
