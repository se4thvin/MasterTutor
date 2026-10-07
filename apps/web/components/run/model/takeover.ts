import type { Controller } from "@mastertutor/contracts";

/** Spec §10.3: the UI flips at once and reverts if control{user} has not arrived in time. */
const TAKEOVER_TIMEOUT_MS = 2_000;
/** A sleeping run must wake and lease a slot before it can hand over. */
const WAKE_TAKEOVER_TIMEOUT_MS = 30_000;
/** A hand back that never sees control{agent} re-reads the run after this (A6). */
export const HANDBACK_TIMEOUT_MS = 5_000;

type TakeoverPhase = "idle" | "requesting" | "releasing";
/** Shown once by the view, then cleared with {type: "seen"}. */
export type TakeoverNotice = "failed" | "timed_out" | "now_in_control";

export interface TakeoverState {
  phase: TakeoverPhase;
  wake: boolean;
  notice: TakeoverNotice | null;
  /** The last request timed out; a late control{user} re-applies control (B6 E5). */
  timedOut: boolean;
}

type TakeoverAction =
  | { type: "request"; wake: boolean }
  | { type: "holder"; holder: Controller }
  | { type: "takeover_failed" }
  | { type: "timeout" }
  | { type: "request_failed" }
  | { type: "release" }
  | { type: "release_failed" }
  | { type: "release_timeout" }
  | { type: "seen" };

export const IDLE_TAKEOVER: TakeoverState = {
  phase: "idle",
  wake: false,
  notice: null,
  timedOut: false,
};

export function takeoverReducer(state: TakeoverState, action: TakeoverAction): TakeoverState {
  switch (action.type) {
    case "request":
      return state.phase === "idle"
        ? { phase: "requesting", wake: action.wake, notice: null, timedOut: false }
        : state;
    case "holder":
      if (state.phase === "requesting") {
        return action.holder === "user" ? IDLE_TAKEOVER : { ...IDLE_TAKEOVER, notice: "failed" };
      }
      if (state.phase === "releasing") return action.holder === "agent" ? IDLE_TAKEOVER : state;
      if (!state.timedOut) return state;
      return action.holder === "user"
        ? { ...IDLE_TAKEOVER, notice: "now_in_control" }
        : { ...state, timedOut: false };
    case "takeover_failed":
      return state.phase === "requesting" ? { ...IDLE_TAKEOVER, notice: "failed" } : state;
    case "timeout":
      return state.phase === "requesting"
        ? { ...IDLE_TAKEOVER, notice: "timed_out", timedOut: true }
        : state;
    case "request_failed":
      return state.phase === "requesting" ? IDLE_TAKEOVER : state;
    case "release":
      return state.phase === "idle" ? { ...IDLE_TAKEOVER, phase: "releasing" } : state;
    case "release_failed":
    case "release_timeout":
      return state.phase === "releasing" ? IDLE_TAKEOVER : state;
    case "seen":
      return state.notice === null ? state : { ...state, notice: null };
  }
}

/** Effective control as the UI shows it: optimistic in both directions. */
export function inControl(controller: Controller, state: TakeoverState): boolean {
  if (state.phase === "requesting") return true;
  if (state.phase === "releasing") return false;
  return controller === "user";
}

export function takeoverTimeoutMs(state: TakeoverState): number | null {
  if (state.phase === "requesting")
    return state.wake ? WAKE_TAKEOVER_TIMEOUT_MS : TAKEOVER_TIMEOUT_MS;
  if (state.phase === "releasing") return HANDBACK_TIMEOUT_MS;
  return null;
}
