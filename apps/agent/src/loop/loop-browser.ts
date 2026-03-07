import type { ComputerAction, FunctionToolName, ScrollPosition } from "@mastertutor/contracts";
import type { ControlGuard } from "../browser/guard.ts";
import type { BlockedNavigation } from "../browser/network-policy.ts";
import type { TargetDescription } from "../browser/page-helpers.ts";
import type { ModelScreenshot } from "../browser/screenshot.ts";
import type { BrowserStorageState } from "../browser/storage-state.ts";
import type { ActionGate, ComputerRun } from "../tools/computer.ts";
import type { ToolRun } from "../tools/registry.ts";
import type { CallApproval } from "../tools/types.ts";
import type { RunSnapshot } from "./run-state.ts";

export interface Observation {
  url: string;
  title: string;
  origin: string | null;
  domHash: string;
  screenshot: ModelScreenshot;
  phash: bigint;
  captcha: boolean;
  scroll: ScrollPosition;
  videoTime: number | null;
}

/** Everything the loop needs from a browser; the real one is SessionLoopBrowser (Task 17). */
export interface LoopBrowser {
  observe(signal: AbortSignal): Promise<Observation>;
  targetFor(
    action: ComputerAction,
    previous: TargetDescription | null,
  ): Promise<TargetDescription | null>;
  runComputer(
    actions: readonly ComputerAction[],
    signal: AbortSignal,
    gate: ActionGate,
  ): Promise<ComputerRun>;
  runFunction(
    name: FunctionToolName,
    args: unknown,
    signal: AbortSignal,
    approval: CallApproval | null,
  ): Promise<ToolRun>;
  navigate(url: string, signal: AbortSignal): Promise<boolean>;
  restoreView(view: { scroll: ScrollPosition | null; videoTime: number | null }): Promise<void>;
  drainBlockedNavigations(): BlockedNavigation[];
  collectStorage(): Promise<BrowserStorageState>;
  applyStorage(state: BrowserStorageState): Promise<() => Promise<void>>;
}

export interface AttachedBrowser {
  browser: LoopBrowser;
  close(): Promise<void>;
}

export type ConnectBrowser = (options: {
  slotName: string;
  run: () => RunSnapshot;
  guard: ControlGuard;
}) => Promise<AttachedBrowser>;
