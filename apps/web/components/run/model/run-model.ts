import {
  TERMINAL_RUN_STATUSES,
  compareEventIds,
  toOrigin,
  type ApprovalMode,
  type ApprovalRequest,
  type ApprovalStatus,
  type Budget,
  type Controller,
  type RunDetail,
  type RunEventRecord,
  type RunStatus,
  type RunStepView,
  type StepAction,
  type StepPhase,
  type StepState,
  type Usage,
  type WaitReason,
} from "@mastertutor/contracts";

export interface StepRow {
  seq: number;
  phase: StepPhase;
  state: StepState;
  caption: string | null;
  url: string | null;
  screenshotKey: string | null;
  action: StepAction | null;
  /** A decide step's reasoning summary (screened model text); null elsewhere. */
  reasoning: string | null;
  at: string;
}
export interface PendingApproval {
  id: string;
  request: ApprovalRequest;
  at: string;
}
export interface ApprovalOutcome {
  id: string;
  request: ApprovalRequest | null;
  status: ApprovalStatus;
  decidedBy: string;
  at: string;
}
interface UserMessage {
  eventId: string;
  text: string;
  at: string;
  /** Sent with Send now: it interrupted the agent (run-mode). */
  interrupt: boolean;
  /** When a decide read it (user_messages_read); null while it waits. */
  pickedUpAt: string | null;
}
/** A person changed the run's approval mode mid-run (run-mode). */
interface ModeChange {
  eventId: string;
  from: ApprovalMode;
  to: ApprovalMode;
  by: string;
  at: string;
}
interface DownloadItem {
  id: string;
  assetId: string;
  filename: string;
  bytes: number;
  at: string;
}
/** A download made during a takeover, held until the person keeps or discards it at hand-back. */
export interface HeldDownload {
  id: string;
  filename: string;
  bytes: number;
}
export interface RunError {
  eventId: string;
  code: string;
  message: string;
  at: string;
}
/** One `control` event; the id lets the view react to every event, even a repeated holder. */
interface ControlChange {
  eventId: string;
  holder: Controller;
}

// Types are exported by the first task that imports them (M7: no export without an importer).

/** Everything the Run view renders, folded from RunDetail + run_steps + RunEvents. */
export interface RunModel {
  runId: string;
  /** Untrusted (model output or the goal): shown as text through untrustedText only. */
  title: string;
  status: RunStatus;
  waitReason: WaitReason | null;
  controller: Controller;
  approvalMode: ApprovalMode;
  model: string;
  slotName: string | null;
  currentUrl: string | null;
  usage: Usage;
  budget: Budget;
  noteId: string | null;
  createdAt: string;
  steps: StepRow[];
  approvals: PendingApproval[];
  outcomes: ApprovalOutcome[];
  messages: UserMessage[];
  modeChanges: ModeChange[];
  downloads: DownloadItem[];
  /** Offered for Keep or Discard at hand-back (runs.handBack's keep); cleared once control is back. */
  heldDownloads: HeldDownload[];
  errors: RunError[];
  lastControl: ControlChange | null;
  /** Origin whose sign-in the vault filled; drives the "Filled securely" badge (run 13 §6). */
  secureFillOrigin: string | null;
  filedPath: string[] | null;
  lastEventId: string | null;
}

/** Errors that inform but never end a run (B6 §7.10); never the "Stopped" reason (A7). */
const INFORMATIONAL_ERRORS: ReadonlySet<string> = new Set([
  "takeover_failed",
  "idle_hand_back",
  "download_blocked",
  "download_too_large",
]);

const SECURE_TOOLS: ReadonlySet<string> = new Set(["fill_credential", "use_passkey"]);
const TERMINAL: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export function isInformational(code: string): boolean {
  return INFORMATIONAL_ERRORS.has(code);
}

export function originOf(url: string | null): string | null {
  return url === null ? null : toOrigin(url);
}

function secureOriginAfter(
  prev: string | null,
  step: StepRow,
  currentUrl: string | null,
): string | null {
  const origin = originOf(step.url ?? currentUrl);
  const filled =
    step.phase === "act" &&
    step.state === "done" &&
    step.action !== null &&
    SECURE_TOOLS.has(step.action.tool);
  if (filled) return origin;
  return prev !== null && origin !== null && origin !== prev ? null : prev;
}

function upsertStep(steps: StepRow[], row: StepRow): StepRow[] {
  const index = steps.findIndex((s) => s.seq === row.seq);
  if (index >= 0) {
    const next = steps.slice();
    next[index] = { ...row, at: steps[index]?.at ?? row.at };
    return next;
  }
  return [...steps, row].sort((a, b) => a.seq - b.seq);
}

function pendingFrom(detail: RunDetail): PendingApproval[] {
  return detail.pendingApprovals
    .filter((a) => a.status === "pending")
    .map((a) => ({ id: a.id, request: a.request, at: a.createdAt }));
}

/**
 * A finished run holds no slot. The agent releases it just after the terminal status, but the
 * stream ends at that status, so the release may never reach an open view.
 */
function heldSlot(status: RunStatus, slotName: string | null): string | null {
  return isTerminal(status) ? null : slotName;
}

/** Adds the snapshot's stored error unless the stream already delivered it. */
function withError(errors: readonly RunError[], detail: RunDetail): RunError[] {
  const error = detail.error;
  if (!error || errors.some((e) => e.code === error.code && e.message === error.message))
    return [...errors];
  const at = detail.finishedAt ?? detail.createdAt;
  return [
    ...errors,
    { eventId: `snapshot-${detail.id}`, code: error.code, message: error.message, at },
  ];
}

export function initRunModel(detail: RunDetail, views: RunStepView[]): RunModel {
  const steps = views
    .map((v): StepRow => ({
      seq: v.seq,
      phase: v.phase,
      state: v.state,
      caption: v.caption,
      url: v.url,
      screenshotKey: v.screenshotKey,
      action: v.action,
      reasoning: v.reasoning,
      at: v.createdAt,
    }))
    .sort((a, b) => a.seq - b.seq);
  let secure: string | null = null;
  let url: string | null = null;
  for (const step of steps) {
    url = step.url ?? url;
    secure = secureOriginAfter(secure, step, url);
  }
  const current = originOf(detail.currentUrl);
  if (secure !== null && current !== null && current !== secure) secure = null;
  return {
    runId: detail.id,
    title: detail.title,
    status: detail.status,
    waitReason: detail.waitReason,
    controller: detail.controller,
    approvalMode: detail.approvalMode,
    model: detail.model,
    slotName: heldSlot(detail.status, detail.slotName),
    currentUrl: detail.currentUrl,
    usage: detail.usage,
    budget: detail.budget,
    noteId: detail.noteId,
    createdAt: detail.createdAt,
    steps,
    approvals: pendingFrom(detail),
    outcomes: [],
    messages: [],
    modeChanges: [],
    // From the snapshot: a reload resumes the stream past their download_ready events.
    downloads: detail.downloads.map(({ id, assetId, filename, bytes, at }) => ({
      id,
      assetId,
      filename,
      bytes,
      at,
    })),
    // From the snapshot: after a reload the stream resumes past their download_pending events (A11).
    heldDownloads: detail.heldDownloads.map(({ id, filename, bytes }) => ({ id, filename, bytes })),
    // A finished run's stream is never opened: its failure comes from the snapshot (D35).
    errors: withError([], detail),
    lastControl: null,
    secureFillOrigin: secure,
    filedPath: null,
    lastEventId: detail.lastEventId,
  };
}

export function applyRunEvent(model: RunModel, record: RunEventRecord): RunModel {
  if (record.runId !== model.runId) return model;
  if (model.lastEventId !== null && compareEventIds(record.id, model.lastEventId) <= 0)
    return model;
  const m: RunModel = { ...model, lastEventId: record.id };
  const e = record.event;
  switch (e.type) {
    case "status":
      return {
        ...m,
        status: e.status,
        waitReason: e.waitReason,
        slotName: heldSlot(e.status, m.slotName),
      };
    case "step": {
      const row: StepRow = {
        seq: e.seq,
        phase: e.phase,
        state: e.state,
        caption: e.caption,
        url: e.url,
        screenshotKey: e.screenshotKey,
        action: e.action,
        reasoning: e.reasoning ?? null,
        at: record.at,
      };
      const currentUrl = e.url ?? m.currentUrl;
      return {
        ...m,
        steps: upsertStep(m.steps, row),
        currentUrl,
        secureFillOrigin: secureOriginAfter(m.secureFillOrigin, row, currentUrl),
      };
    }
    case "control":
      return {
        ...m,
        controller: e.holder,
        lastControl: { eventId: record.id, holder: e.holder },
        // The hand-back settled them: kept ones arrive as download_ready, the rest are discarded.
        ...(e.holder === "agent" ? { heldDownloads: [] } : {}),
      };
    case "slot":
      return { ...m, slotName: heldSlot(m.status, e.slotName) };
    case "approval_requested":
      return m.approvals.some((a) => a.id === e.approvalId)
        ? m
        : {
            ...m,
            approvals: [...m.approvals, { id: e.approvalId, request: e.request, at: record.at }],
          };
    case "approval_resolved": {
      const found = m.approvals.find((a) => a.id === e.approvalId);
      return {
        ...m,
        approvals: m.approvals.filter((a) => a.id !== e.approvalId),
        outcomes: [
          ...m.outcomes,
          {
            id: e.approvalId,
            request: found?.request ?? null,
            status: e.status,
            decidedBy: e.decidedBy,
            at: record.at,
          },
        ],
      };
    }
    case "block_added":
      return { ...m, noteId: e.noteId };
    case "budget":
      return { ...m, usage: e.usage, budget: e.budget };
    case "user_message":
      return {
        ...m,
        messages: [
          ...m.messages,
          {
            eventId: record.id,
            text: e.text,
            at: record.at,
            interrupt: e.interrupt === true,
            pickedUpAt: null,
          },
        ],
      };
    case "user_messages_read":
      return {
        ...m,
        messages: m.messages.map((message) =>
          message.pickedUpAt === null && compareEventIds(message.eventId, e.through) <= 0
            ? { ...message, pickedUpAt: record.at }
            : message,
        ),
      };
    case "approval_mode_changed":
      return {
        ...m,
        approvalMode: e.to,
        modeChanges: [
          ...m.modeChanges,
          { eventId: record.id, from: e.from, to: e.to, by: e.by, at: record.at },
        ],
      };
    case "download_pending":
      return m.heldDownloads.some((d) => d.id === e.downloadId)
        ? m
        : {
            ...m,
            heldDownloads: [
              ...m.heldDownloads,
              { id: e.downloadId, filename: e.filename, bytes: e.bytes },
            ],
          };
    case "download_ready":
      // Replayed after the snapshot already listed it: listed once.
      if (m.downloads.some((d) => d.id === e.downloadId))
        return { ...m, heldDownloads: m.heldDownloads.filter((d) => d.id !== e.downloadId) };
      return {
        ...m,
        heldDownloads: m.heldDownloads.filter((d) => d.id !== e.downloadId),
        downloads: [
          ...m.downloads,
          {
            id: e.downloadId,
            assetId: e.assetId,
            filename: e.filename,
            bytes: e.bytes,
            at: record.at,
          },
        ],
      };
    case "error":
      return {
        ...m,
        errors: [
          ...m.errors,
          { eventId: record.id, code: e.code, message: e.message, at: record.at },
        ],
      };
    case "filed":
      return { ...m, noteId: e.noteId, filedPath: e.path };
    case "model_fallback":
      return { ...m, model: e.to };
    case "title":
      return { ...m, title: e.title };
    // Guard rows and cards are Track U's (U1); until then the event only advances the cursor.
    case "capture_brief":
    case "capture_asked":
    case "capture_answered":
    case "capture_selected":
    case "guard":
      return m;
  }
}

/** One frame's worth of records, folded into one model: one render per batch (A9). */
export function applyRunEvents(model: RunModel, records: readonly RunEventRecord[]): RunModel {
  return records.reduce(applyRunEvent, model);
}

/** Settles the model on a re-read RunDetail (A6: a hand back whose control event never came). */
export function syncRunModel(model: RunModel, detail: RunDetail): RunModel {
  if (detail.id !== model.runId) return model;
  return {
    ...model,
    title: detail.title,
    status: detail.status,
    waitReason: detail.waitReason,
    controller: detail.controller,
    approvalMode: detail.approvalMode,
    slotName: heldSlot(detail.status, detail.slotName),
    currentUrl: detail.currentUrl ?? model.currentUrl,
    usage: detail.usage,
    budget: detail.budget,
    approvals: pendingFrom(detail),
    errors: withError(model.errors, detail),
    // The re-read is authoritative for what is still held; any newer streamed one is kept too.
    heldDownloads:
      detail.controller === "agent"
        ? []
        : [
            ...detail.heldDownloads.map(({ id, filename, bytes }) => ({ id, filename, bytes })),
            ...model.heldDownloads.filter((d) => !detail.heldDownloads.some((h) => h.id === d.id)),
          ],
  };
}

export function latestError(model: RunModel): RunError | null {
  return model.errors.at(-1) ?? null;
}

/** The error that explains a failed run: the last one that is not merely informational (A7). */
export function failureOf(model: RunModel): RunError | null {
  for (let i = model.errors.length - 1; i >= 0; i--) {
    const error = model.errors[i];
    if (error && !isInformational(error.code)) return error;
  }
  return null;
}

export function latestStep(model: RunModel): StepRow | null {
  return model.steps.at(-1) ?? null;
}

export function latestPointerStep(model: RunModel): StepRow | null {
  for (let i = model.steps.length - 1; i >= 0; i--) {
    const step = model.steps[i];
    if (step?.action?.point) return step;
  }
  return null;
}

export function latestScreenshotSeq(model: RunModel): number | null {
  for (let i = model.steps.length - 1; i >= 0; i--) {
    const step = model.steps[i];
    if (step?.screenshotKey) return step.seq;
  }
  return null;
}

export function captureCount(model: RunModel): number {
  return model.steps.filter(
    (s) => s.phase === "act" && s.state === "done" && s.action?.tool === "capture",
  ).length;
}
