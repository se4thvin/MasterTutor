import { BYPASS_DECIDER, POLICY_DECIDER, compareEventIds } from "@mastertutor/contracts";
import { APPROVAL_MODE_SHORT } from "@/components/approval-mode/modes.ts";
import type { StatusMarkStatus } from "@/lib/status.ts";
import type { IconName } from "@/lib/ui/vocabulary.ts";
import { requestSummary } from "./approval-copy.ts";
import { errorLine, hostAndPath } from "./copy.ts";
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
/** One paragraph of a reasoning summary (the whole summary is capped by the contract). */
const MAX_PARAGRAPH = 1_200;

export interface PendingMessage {
  /** The client id: one entry per sent message, however often it is listed. */
  key: string;
  text: string;
  /** Send now (run-mode). */
  interrupt?: boolean;
  afterEventId: string | null;
  /** When the user sent it (stable across renders). */
  sentAt: string;
}

/**
 * One entry of the run's thread (fe-run-chat): the agent's side (pages it opened, its reasoning
 * summaries, its actions and the approval it waits on), the person's messages, and system lines.
 * Every text is untrusted and arrives cleaned; the view renders it as plain text inside <bdi>.
 */
export type ThreadItem =
  | {
      kind: "step";
      key: string;
      seq: number;
      verb: string;
      verbKind: "cred" | "sig" | null;
      glyph: IconName;
      line: string;
      status: StatusMarkStatus;
      ts: string;
      at: string;
      credential: boolean;
      /**
       * The step whose screenshot replays this row: its own, else the screen it was taken on (the
       * agent stores screenshots on observe steps only). Null before the first screenshot.
       */
      shotSeq: number | null;
      current: boolean;
    }
  | {
      kind: "page";
      key: string;
      seq: number;
      /** Never truncated: the host is the security signal (S7). */
      host: string;
      path: string;
      shotSeq: number | null;
      ts: string;
      at: string;
    }
  | {
      kind: "thought";
      key: string;
      seq: number;
      title: string | null;
      paragraphs: string[];
      ts: string;
      at: string;
    }
  | { kind: "approval"; key: string; approvalId: string; line: string; ts: string; at: string }
  | {
      kind: "message";
      key: string;
      text: string;
      ts: string;
      at: string;
      pending: boolean;
      /** Queued for the next step, or Send now (run-mode). */
      delivery: "queued" | "interrupted";
      /** When the agent read it (run clock); null until then. */
      pickedUp: string | null;
    }
  | {
      /** A person switched the approval mode mid-run (run-mode); `ts` is the wall-clock time. */
      kind: "mode";
      key: string;
      line: string;
      bypass: boolean;
      ts: string;
      at: string;
    }
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

const GLYPHS: Readonly<Record<string, IconName>> = {
  read_page: "read",
  capture: "capture",
  fill_credential: "password",
  use_passkey: "passkey",
  video: "video",
  annotate: "edit",
};

/** What an action card shows beside its verb: the kind of input, else the tool. */
function glyphFor(step: StepRow): IconName {
  if (step.phase === "approve") return "hand";
  const action = step.action;
  if (action?.tool !== "computer") return (action && GLYPHS[action.tool]) ?? "live";
  if (action.pointer === "scroll") return "scroll";
  if (action.pointer) return "pointer";
  return /^(?:type|press) /.test(action.summary) ? "keyboard" : "live";
}

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
    const bypass = outcome.decidedBy === BYPASS_DECIDER;
    const who = viewerId !== null && outcome.decidedBy === viewerId ? "You" : "Someone else";
    lead =
      outcome.status === "approved"
        ? policy
          ? "Approved by policy"
          : bypass
            ? "Approved in Bypass"
            : `${who} approved`
        : outcome.status === "denied"
          ? policy
            ? "Blocked by policy"
            : `${who} denied`
          : `${who} redirected`;
  }
  return outcome.request ? `${lead}: ${requestSummary(outcome.request)}` : lead;
}

/**
 * The one row shown as selected during replay. Rows that share a screenshot (the page card and the
 * acts on that screen) are not all selected: the clicked row is, while its screenshot is on screen;
 * after the replay moves on, the first row of the shown screenshot is.
 */
export function selectedRowSeq(
  items: readonly ThreadItem[],
  replaySeq: number | null,
  clickedSeq: number | null,
): number | null {
  if (replaySeq === null) return null;
  const rows = items.filter(
    (item): item is Extract<ThreadItem, { kind: "step" | "page" }> =>
      (item.kind === "step" || item.kind === "page") && item.shotSeq === replaySeq,
  );
  return (rows.find((row) => row.seq === clickedSeq) ?? rows[0])?.seq ?? null;
}

/**
 * A reasoning summary as plain text: paragraphs (blank-line separated), each cleaned; a leading
 * `**Title**` paragraph becomes the title, and other `**` emphasis markers are dropped. Nothing in
 * it is ever parsed as markup.
 */
export function thoughtParts(summary: string): { title: string | null; paragraphs: string[] } {
  const raw = summary.split(/\n\s*\n/);
  const heading = /^\s*\*\*([^*\n]+)\*\*\s*$/.exec(raw[0] ?? "");
  const clean = (text: string) => untrustedText(text.replace(/\*\*/g, ""), MAX_PARAGRAPH);
  const title = heading ? clean(heading[1]!) || null : null;
  const paragraphs = (heading ? raw.slice(1) : raw).map(clean).filter((text) => text !== "");
  return { title, paragraphs };
}

/** The time of day, as the viewer reads it ("2:31 PM"). */
function wallClock(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function elapsedClock(from: string, at: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(at) - Date.parse(from)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function threadItems(
  model: RunModel,
  pending: readonly PendingMessage[],
  viewerId: string | null,
): ThreadItem[] {
  const clock = (at: string) => elapsedClock(model.createdAt, at);
  const shown = model.steps.filter((s) => s.phase === "act" || s.phase === "approve");
  const lastSeq = shown.at(-1)?.seq ?? null;
  const live = !isTerminal(model.status);
  const items: ThreadItem[] = [];
  let lastShot: number | null = null;
  let lastPage: string | null = null;
  for (const step of model.steps) {
    if (step.screenshotKey !== null) lastShot = step.seq;
    const ts = clock(step.at);
    if (step.phase === "observe" && step.state === "done" && step.url !== null) {
      const page = hostAndPath(step.url);
      const where = page ? `${page.host}${page.path}` : null;
      if (page && where !== lastPage) {
        lastPage = where;
        items.push({
          kind: "page",
          key: `page-${step.seq}`,
          seq: step.seq,
          host: page.host,
          path: page.path,
          shotSeq: lastShot,
          ts,
          at: step.at,
        });
      }
    } else if (step.phase === "decide" && step.reasoning) {
      const { title, paragraphs } = thoughtParts(step.reasoning);
      if (title || paragraphs.length > 0)
        items.push({
          kind: "thought",
          key: `thought-${step.seq}`,
          seq: step.seq,
          title,
          paragraphs,
          ts,
          at: step.at,
        });
    } else if (step.phase === "approve" && step.state === "started" && model.approvals.length > 0) {
      // The approval card below speaks for the approval being waited on.
      continue;
    } else if (step.phase === "act" || step.phase === "approve") {
      const credential =
        step.action?.tool === "fill_credential" || step.action?.tool === "use_passkey";
      items.push({
        kind: "step",
        key: `step-${step.seq}`,
        seq: step.seq,
        verb: verbFor(step),
        verbKind: credential ? "cred" : step.phase === "approve" ? "sig" : null,
        glyph: glyphFor(step),
        line: untrustedText(step.action?.summary ?? step.caption, 200) || `Step ${step.seq}`,
        status: stepStatus(step),
        ts,
        at: step.at,
        credential,
        shotSeq: lastShot,
        current: live && step.seq === lastSeq,
      });
    }
  }
  for (const a of model.approvals) {
    items.push({
      kind: "approval",
      key: `approval-${a.id}`,
      approvalId: a.id,
      line: requestSummary(a.request),
      ts: clock(a.at),
      at: a.at,
    });
  }
  for (const m of model.messages) {
    items.push({
      kind: "message",
      key: `msg-${m.eventId}`,
      // Any member's chat can carry bidi overrides or invisible characters (S6).
      text: untrustedText(m.text, MAX_MESSAGE),
      ts: clock(m.at),
      at: m.at,
      pending: false,
      delivery: m.interrupt ? "interrupted" : "queued",
      pickedUp: m.pickedUpAt === null ? null : clock(m.pickedUpAt),
    });
  }
  for (const c of model.modeChanges) {
    const who = viewerId !== null && c.by === viewerId ? "You" : "Someone else";
    items.push({
      kind: "mode",
      key: `mode-${c.eventId}`,
      line: `${who} switched to ${APPROVAL_MODE_SHORT[c.to]}`,
      bypass: c.to === "bypass",
      ts: wallClock(c.at),
      at: c.at,
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
      delivery: p.interrupt ? "interrupted" : "queued",
      pickedUp: null,
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

/** The newest agent line, for the compact peek bar: thinking, else the latest agent entry. */
export function peekLine(items: readonly ThreadItem[], thinking: ThinkingState | null): string {
  if (thinking?.working) return thinking.label;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    switch (item.kind) {
      case "approval":
        return `Needs your approval: ${item.line}`;
      case "thought":
        return item.title ?? item.paragraphs[0] ?? "";
      case "step":
        return item.line;
      case "page":
        return `Opened ${item.host}${item.path}`;
      default:
        continue;
    }
  }
  return thinking?.label ?? "No activity yet";
}

export function summaryLabel(model: RunModel): string {
  const steps = model.steps.filter((s) => s.phase === "act").length;
  const captures = captureCount(model);
  return `${steps} ${steps === 1 ? "step" : "steps"} · ${captures} ${captures === 1 ? "capture" : "captures"}`;
}
