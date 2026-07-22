import { POLICY_DECIDER, compareEventIds } from "@mastertutor/contracts";
import type { StatusMarkStatus } from "@/lib/status.ts";
import { requestSummary } from "./approval-copy.ts";
import { errorLine } from "./copy.ts";
import {
  captureCount,
  isInformational,
  isTerminal,
  type ApprovalOutcome,
  type RunModel,
  type StepRow,
} from "./run-model.ts";
import { untrustedText } from "./untrusted-text.ts";

/** A chat message is shown whole up to this many characters. */
const MAX_MESSAGE = 2_000;

export interface PendingMessage {
  /** The client id: one entry per sent message, however often it is listed. */
  key: string;
  text: string;
  afterEventId: string | null;
  /** When the user sent it (stable across renders). */
  sentAt: string;
}

export type TimelineItem =
  | {
      kind: "step";
      key: string;
      seq: number;
      verb: string;
      verbKind: "cred" | "sig" | null;
      line: string;
      status: StatusMarkStatus;
      ts: string;
      at: string;
      credential: boolean;
      hasShot: boolean;
      current: boolean;
    }
  | { kind: "message"; key: string; text: string; ts: string; at: string; pending: boolean }
  | {
      kind: "decision";
      key: string;
      line: string;
      status: StatusMarkStatus;
      ts: string;
      at: string;
    }
  | { kind: "download"; key: string; line: string; ts: string; at: string }
  | { kind: "notice"; key: string; line: string; tone: "info" | "warn"; ts: string; at: string };

export interface ThinkingState {
  label: string;
  /** When the current spell of thinking began: the first observe/decide since the last act. */
  since: string;
  /** When it ended (the act began); null while still thinking. */
  until: string | null;
  working: boolean;
}

const VERBS: Readonly<Record<string, string>> = {
  read_page: "Read",
  capture: "Capture",
  fill_credential: "Fill",
  use_passkey: "Passkey",
  video: "Video",
  annotate: "Note",
};

/** A computer step without `pointer` (recorded before A1 landed, or a keyboard action) says "Act". */
function verbFor(step: StepRow): string {
  if (step.phase === "approve") return "Approve";
  const tool = step.action?.tool;
  if (tool === "computer") {
    const pointer = step.action?.pointer;
    if (pointer === "scroll") return "Scroll";
    if (pointer === "click" || pointer === "double_click") return "Click";
    return "Act";
  }
  return (tool && VERBS[tool]) ?? "Act";
}

function stepStatus(step: StepRow): StatusMarkStatus {
  if (step.state === "done") return "done";
  if (step.state === "aborted" || step.state === "skipped") return "cancelled";
  return step.phase === "approve" ? "pending" : "running";
}

/** "You" only for the viewer; another member is "Someone else"; policy is named (A4, D4). */
function decisionLine(outcome: ApprovalOutcome, viewerId: string | null): string {
  let lead: string;
  if (outcome.status === "superseded" || outcome.status === "pending") {
    lead = "No longer needed";
  } else {
    const policy = outcome.decidedBy === POLICY_DECIDER;
    const who = viewerId !== null && outcome.decidedBy === viewerId ? "You" : "Someone else";
    lead =
      outcome.status === "approved"
        ? policy
          ? "Approved by policy"
          : `${who} approved`
        : outcome.status === "denied"
          ? policy
            ? "Blocked by policy"
            : `${who} denied`
          : `${who} redirected`;
  }
  return outcome.request ? `${lead}: ${requestSummary(outcome.request)}` : lead;
}

export function elapsedClock(from: string, at: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(at) - Date.parse(from)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function timelineItems(
  model: RunModel,
  pending: readonly PendingMessage[],
  viewerId: string | null,
): TimelineItem[] {
  const clock = (at: string) => elapsedClock(model.createdAt, at);
  const shown = model.steps.filter((s) => s.phase === "act" || s.phase === "approve");
  const lastSeq = shown.at(-1)?.seq ?? null;
  const live = !isTerminal(model.status);
  const items: TimelineItem[] = shown.map((step) => {
    const credential =
      step.action?.tool === "fill_credential" || step.action?.tool === "use_passkey";
    return {
      kind: "step",
      key: `step-${step.seq}`,
      seq: step.seq,
      verb: verbFor(step),
      verbKind: credential ? "cred" : step.phase === "approve" ? "sig" : null,
      line: untrustedText(step.action?.summary ?? step.caption, 200) || `Step ${step.seq}`,
      status: stepStatus(step),
      ts: clock(step.at),
      at: step.at,
      credential,
      hasShot: step.screenshotKey !== null,
      current: live && step.seq === lastSeq,
    };
  });
  for (const m of model.messages) {
    items.push({
      kind: "message",
      key: `msg-${m.eventId}`,
      // Any member's chat can carry bidi overrides or invisible characters (S6).
      text: untrustedText(m.text, MAX_MESSAGE),
      ts: clock(m.at),
      at: m.at,
      pending: false,
    });
  }
  // Each echo clears at most one pending copy; a client id is listed once.
  const echoes = new Set<string>();
  const seen = new Set<string>();
  for (const p of pending) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    const echo = model.messages.find(
      (m) =>
        !echoes.has(m.eventId) &&
        m.text === p.text &&
        (p.afterEventId === null || compareEventIds(m.eventId, p.afterEventId) > 0),
    );
    if (echo) {
      echoes.add(echo.eventId);
      continue;
    }
    items.push({
      kind: "message",
      key: `pending-${p.key}`,
      text: untrustedText(p.text, MAX_MESSAGE),
      ts: clock(p.sentAt),
      at: p.sentAt,
      pending: true,
    });
  }
  for (const o of model.outcomes) {
    items.push({
      kind: "decision",
      key: `decision-${o.id}`,
      line: decisionLine(o, viewerId),
      status: o.status === "approved" || o.status === "edited" ? "done" : "cancelled",
      ts: clock(o.at),
      at: o.at,
    });
  }
  for (const d of model.downloads) {
    items.push({
      kind: "download",
      key: `download-${d.id}`,
      line: `Downloaded ${untrustedText(d.filename, 120) || "a file"}`,
      ts: clock(d.at),
      at: d.at,
    });
  }
  for (const e of model.errors) {
    items.push({
      kind: "notice",
      key: `error-${e.eventId}`,
      line: errorLine(e),
      tone: isInformational(e.code) ? "info" : "warn",
      ts: clock(e.at),
      at: e.at,
    });
  }
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function thinkingState(model: RunModel): ThinkingState | null {
  if (model.status !== "running" || model.controller !== "agent") return null;
  // The spell of thinking since the last act (I2): its start never moves between observe and
  // decide, and it ends when the next act begins.
  const lastActIndex = model.steps.findLastIndex((s) => s.phase === "act" && s.state !== "started");
  const spell = model.steps.slice(lastActIndex + 1);
  const firstThought = spell.find((s) => s.phase === "observe" || s.phase === "decide");
  const last = model.steps.at(-1);
  const since = firstThought?.at ?? model.steps[lastActIndex]?.at ?? model.createdAt;
  if (last?.phase === "act" && last.state === "started") {
    return { label: "Thinking about the next step", since, until: last.at, working: false };
  }
  const thought =
    last && (last.phase === "observe" || last.phase === "decide") && last.state === "started"
      ? untrustedText(last.caption, 160)
      : "";
  return { label: thought || "Thinking about the next step", since, until: null, working: true };
}

export function summaryLabel(model: RunModel): string {
  const steps = model.steps.filter((s) => s.phase === "act").length;
  const captures = captureCount(model);
  return `${steps} ${steps === 1 ? "step" : "steps"} · ${captures} ${captures === 1 ? "capture" : "captures"}`;
}
