import { z } from "zod";
import { ApprovalRequest, PersonDecider } from "./approval.ts";
import { Budget, Usage } from "./budget.ts";
import {
  ApprovalMode,
  ApprovalStatus,
  BlockOrigin,
  BlockType,
  Controller,
  FiledBy,
  ObserverMode,
  RunStatus,
  StepPhase,
  StepState,
  WaitReason,
} from "./enums.ts";
import { GuardCategory, GuardStage, GuardVerdictName } from "./guard-codes.ts";
import { IsoDateTime, SlotName, Uuid } from "./primitives.ts";
import { RUN_TITLE_MAX } from "./run-title.ts";
import { ReasoningSummary } from "./step-result.ts";
import { ToolName, type ComputerAction } from "./tool-call.ts";

/** Pointer kinds the run view animates; the agent sets `pointer` for computer steps that start with one. */
export const POINTER_KINDS = ["click", "double_click", "drag", "move", "scroll"] as const;
export type PointerKind = (typeof POINTER_KINDS)[number];

/** The pointer kind of a computer action, or undefined for keyboard, wait and screenshot actions. */
export function pointerOf(action: ComputerAction): PointerKind | undefined {
  return POINTER_KINDS.find((kind) => kind === action.type);
}

/** What the UI shows for a step; `point` drives the overlay cursor, `pointer` the click pulse. */
export const StepAction = z.object({
  tool: ToolName,
  summary: z.string().max(300),
  point: z.object({ x: z.number().int(), y: z.number().int() }).nullable(),
  pointer: z.enum(POINTER_KINDS).optional(),
});
export type StepAction = z.infer<typeof StepAction>;

export const RUN_EVENT_TYPES = [
  "status",
  "step",
  "control",
  "slot",
  "approval_requested",
  "approval_resolved",
  "block_added",
  "budget",
  "user_message",
  "user_messages_read",
  "approval_mode_changed",
  "download_ready",
  "download_pending",
  "error",
  "filed",
  "model_fallback",
  "title",
  "guard",
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/** Stored in run_events.payload and streamed over SSE (spec §6). */
export const RunEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: RunStatus,
    waitReason: WaitReason.nullable(),
    reason: z.string().max(500).nullable(),
  }),
  z.object({
    type: z.literal("step"),
    seq: z.number().int().nonnegative(),
    phase: StepPhase,
    state: StepState,
    caption: z.string().max(300).nullable(),
    url: z.string().max(4_096).nullable(),
    screenshotKey: z.string().max(1_024).nullable(),
    action: StepAction.nullable(),
    /** A decide step's reasoning summary; absent on other steps and on events stored before it. */
    reasoning: ReasoningSummary.optional(),
  }),
  z.object({ type: z.literal("control"), holder: Controller }),
  z.object({ type: z.literal("slot"), slotName: SlotName.nullable() }),
  z.object({ type: z.literal("approval_requested"), approvalId: Uuid, request: ApprovalRequest }),
  z.object({
    type: z.literal("approval_resolved"),
    approvalId: Uuid,
    status: ApprovalStatus,
    decidedBy: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("block_added"),
    noteId: Uuid,
    blockId: Uuid,
    blockType: BlockType,
    origin: BlockOrigin,
  }),
  z.object({ type: z.literal("budget"), usage: Usage, budget: Budget }),
  /**
   * A person's message. `interrupt` (Send now) stops the agent's current model call and the rest
   * of its batch; absent or false, it waits for the next decide (queued).
   */
  z.object({
    type: z.literal("user_message"),
    text: z.string().min(1).max(4_000),
    interrupt: z.boolean().optional(),
  }),
  /** The agent read every user_message up to and including this event id (into a decide). */
  z.object({ type: z.literal("user_messages_read"), through: z.string().regex(/^[0-9]+$/) }),
  /**
   * A person changed the run's approval mode mid-run (run-mode); `by` is their user id, never a
   * machine decider (D52: only a person changes the mode).
   */
  z.object({
    type: z.literal("approval_mode_changed"),
    from: ApprovalMode,
    to: ApprovalMode,
    by: PersonDecider,
  }),
  /**
   * A download made while a person held control, waiting for them to keep or discard it at
   * hand-back. Nothing is stored or shown to the agent until it is kept.
   */
  z.object({
    type: z.literal("download_pending"),
    downloadId: Uuid,
    filename: z.string().max(255),
    bytes: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("download_ready"),
    downloadId: Uuid,
    assetId: Uuid,
    filename: z.string().max(255),
    bytes: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1).max(64),
    message: z.string().max(500),
  }),
  z.object({
    type: z.literal("filed"),
    noteId: Uuid,
    folderId: Uuid,
    path: z.array(z.string().max(120)).max(8),
    filedBy: FiledBy,
  }),
  z.object({
    type: z.literal("model_fallback"),
    from: z.string().max(64),
    to: z.string().max(64),
  }),
  /** The run's generated title, stored once (runs.title); model output, so shown as text only. */
  z.object({ type: z.literal("title"), title: z.string().min(1).max(RUN_TITLE_MAX) }),
  /** A Guard review's outcome (spec §6.10): codes and counts only, never the rationale. */
  z.object({
    type: z.literal("guard"),
    verdict: GuardVerdictName,
    category: GuardCategory,
    stage: GuardStage,
    rollout: ObserverMode,
    /** False in shadow (recorded only) and for allow or flag. */
    applied: z.boolean(),
    items: z.number().int().min(0).max(20),
    /** Reviewed items whose typed text came from another origin (the watcher's egress signal). */
    flows: z.number().int().min(0).max(20),
  }),
]);
export type RunEvent = z.infer<typeof RunEvent>;

export const RunEventRecord = z.object({
  id: z.string().regex(/^[0-9]+$/),
  runId: Uuid,
  at: IsoDateTime,
  event: RunEvent,
});
export type RunEventRecord = z.infer<typeof RunEventRecord>;
