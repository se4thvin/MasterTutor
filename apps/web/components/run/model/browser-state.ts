import { isTerminal, latestStep, type RunModel } from "./run-model.ts";
import { inControl, type TakeoverState } from "./takeover.ts";

/** Spec §10.4, run 12 and run 13 §6. */
export const BROWSER_STATES = [
  "live",
  "acting",
  "approval",
  "control",
  "paused",
  "reconnecting",
  "replay",
] as const;
export type BrowserState = (typeof BROWSER_STATES)[number];
type Connection = "connecting" | "open" | "lost";

export interface ViewFlags {
  connection: Connection;
  takeover: TakeoverState;
  replaying: boolean;
  liveRetrying: boolean;
}

export function deriveBrowserState(model: RunModel, flags: ViewFlags): BrowserState {
  if (flags.replaying) return "replay";
  const terminal = isTerminal(model.status);
  if (!terminal && inControl(model.controller, flags.takeover)) return "control";
  if (terminal) return "paused";
  if (flags.connection === "lost" || flags.liveRetrying) return "reconnecting";
  if (model.approvals.length > 0) return "approval";
  if (model.status === "sleeping" || model.status === "queued" || model.slotName === null)
    return "paused";
  const last = latestStep(model);
  if (model.status === "running" && last?.phase === "act" && last.state === "started")
    return "acting";
  return "live";
}

/** D19: take over at any time, including while an approval waits (A5; B3 E R-E15 supersedes it). */
export function canTakeOver(
  model: RunModel,
  state: BrowserState,
  takeover: TakeoverState,
): boolean {
  return (
    !isTerminal(model.status) &&
    model.status !== "queued" &&
    model.controller === "agent" &&
    takeover.phase === "idle" &&
    (state === "live" || state === "acting" || state === "approval" || state === "paused")
  );
}
