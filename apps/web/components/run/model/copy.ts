import { safePageUrl } from "@/lib/notes/provenance.ts";
import { markStatus, type StatusMarkStatus } from "@/lib/status.ts";
import type { BrowserState } from "./browser-state.ts";
import {
  failureOf,
  isTerminal,
  latestStep,
  type RunError,
  type RunModel,
  type StepRow,
} from "./run-model.ts";
import type { TakeoverNotice, TakeoverState } from "./takeover.ts";
import { untrustedText } from "./untrusted-text.ts";

type Tone = "signal" | "tint" | "warn" | "muted" | "ok";

export const STATE_PILL: Record<BrowserState, { label: string; tone: Tone; pulse: boolean }> = {
  live: { label: "Live", tone: "signal", pulse: true },
  acting: { label: "Agent acting", tone: "tint", pulse: true },
  approval: { label: "Needs you", tone: "signal", pulse: true },
  control: { label: "You", tone: "tint", pulse: false },
  paused: { label: "Paused", tone: "muted", pulse: false },
  reconnecting: { label: "Reconnecting", tone: "warn", pulse: false },
  replay: { label: "Replay", tone: "muted", pulse: false },
};

interface UrlParts {
  /** As the URL parser returns it: lower case, punycode, with any port. Never truncated (S7). */
  host: string;
  /** Path and query, cleaned and capped; the view truncates this first. */
  path: string;
  secure: boolean;
}

export function hostAndPath(url: string | null): UrlParts | null {
  const parsed = url ? safePageUrl(url) : null;
  if (!parsed) return null;
  return {
    host: parsed.host,
    path: untrustedText(`${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`, 200),
    secure: parsed.protocol === "https:",
  };
}

/**
 * The host alone, for approval titles. Unlike lib/notes/format.ts `hostOf` (note sources), it keeps
 * `www.` and the port, because here the host is the security signal (S7).
 */
export function pageHost(url: string): string {
  return hostAndPath(url)?.host ?? untrustedText(url, 60);
}

function actCount(model: RunModel): number {
  return model.steps.filter((s) => s.phase === "act").length;
}

export function actNumber(model: RunModel, seq: number): number {
  return model.steps.filter((s) => s.phase === "act" && s.seq <= seq).length;
}

/** Informational run errors (B6 §8): shown as toasts and timeline notices, never as the failure. */
export const INFO_ERROR_COPY: Readonly<Record<string, string>> = {
  takeover_failed: "Couldn't take control. The agent kept it.",
  idle_hand_back: "You were idle for 15 minutes, so the agent took the controls back.",
  download_blocked: "Take over to download files.",
  download_too_large: "That download was too large to keep.",
};

export function errorLine(error: RunError): string {
  return (
    INFO_ERROR_COPY[error.code] ?? (untrustedText(error.message, 200) || "Something went wrong")
  );
}

export const TAKEOVER_NOTICE: Record<TakeoverNotice, string> = {
  failed: "Couldn't take control. The agent kept it.",
  timed_out: "The browser didn't respond, so the agent still has control.",
  now_in_control: "You're in control now.",
};

/** B6 A9 codes: FORBIDDEN = another member holds control; CONFLICT = the run has finished. */
export function takeControlErrorCopy(code: string | null): string {
  if (code === "FORBIDDEN") return "Someone else is in control of this browser.";
  if (code === "CONFLICT") return "This run has finished, so there is nothing to take over.";
  return "Couldn't take control. Try again.";
}

export function handBackErrorCopy(code: string | null): string {
  if (code === "FORBIDDEN") return "Someone else is in control, so only they can hand back.";
  return "Couldn't hand back. You're still in control.";
}

interface PausedCopy {
  title: string;
  detail: string;
  canResume: boolean;
}

export function pausedCopy(model: RunModel): PausedCopy {
  switch (model.status) {
    case "sleeping":
      return {
        title: "Paused",
        detail: `Sleeping. Context saved at step ${actCount(model)}`,
        canResume: true,
      };
    case "queued":
      return { title: "Queued", detail: "Waiting for a free browser", canResume: false };
    case "completed":
      return {
        title: "Finished",
        detail: model.filedPath
          ? `Filed in ${model.filedPath.map((p) => untrustedText(p, 60)).join(" › ")}`
          : "The note is in your library",
        canResume: false,
      };
    case "failed":
      return {
        title: "Stopped",
        detail: untrustedText(failureOf(model)?.message, 160) || "Something went wrong",
        canResume: false,
      };
    case "cancelled":
      return { title: "Cancelled", detail: "This run was stopped", canResume: false };
    default:
      return { title: "Starting", detail: "Waiting for a browser", canResume: false };
  }
}

export function captionFor(
  state: BrowserState,
  model: RunModel,
  takeover: TakeoverState,
  replayStep: StepRow | null,
): string {
  switch (state) {
    case "replay":
      return untrustedText(replayStep?.caption, 160) || "Replaying";
    case "control":
      if (takeover.phase === "requesting") {
        return takeover.wake
          ? "Waking the browser so you can take control…"
          : "Handing you the controls…";
      }
      return "You're in control. Screenshots are off";
    case "reconnecting":
      return "Reconnecting to the browser…";
    case "approval":
      return "Waiting for your approval";
    case "paused": {
      const copy = pausedCopy(model);
      return `${copy.title}. ${copy.detail}`;
    }
    case "acting":
      return untrustedText(latestStep(model)?.caption, 160) || "Working";
    case "live": {
      if (model.status === "waiting" && model.waitReason === "captcha") {
        return "Needs you: solve the CAPTCHA, then hand back";
      }
      if (model.status === "waiting" && model.waitReason === "takeover") {
        return "Needs you: the agent is stuck. Take over to help";
      }
      if (model.status === "waiting" && model.waitReason === "otp")
        return "Waiting for the code sent to you";
      const last = latestStep(model);
      const thinking =
        last && (last.phase === "observe" || last.phase === "decide") && last.state === "started";
      return (thinking ? untrustedText(last.caption, 160) : "") || "Thinking about the next step";
    }
  }
}

export function statusLabel(state: BrowserState, model: RunModel): string {
  switch (state) {
    case "control":
      return "You have control";
    case "approval":
      return "Needs your approval";
    case "paused":
      return pausedCopy(model).title;
    case "reconnecting":
      return "Reconnecting";
    case "replay":
      return "Replaying";
    default:
      return model.status === "waiting" ? "Needs you" : "Running";
  }
}

export function markFor(state: BrowserState, model: RunModel): StatusMarkStatus {
  // A finished run's mark comes from the one run-status mapping (lib/status.ts).
  if (isTerminal(model.status)) return markStatus(model.status);
  return state === "paused" ? "pending" : "running";
}

export function stepLabel(model: RunModel): string | null {
  const count = actCount(model);
  return count > 0 ? `Step ${count}` : null;
}

export function shortRunId(runId: string): string {
  return `run_${runId.slice(0, 8)}`;
}
