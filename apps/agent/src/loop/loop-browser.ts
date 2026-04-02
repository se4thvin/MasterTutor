import type {
  ApprovalRequest,
  ComputerAction,
  FunctionToolName,
  ScrollPosition,
} from "@mastertutor/contracts";
import type { ControlGuard } from "../browser/guard.ts";
import type { BlockedDownload } from "../browser/download-gate.ts";
import type { BlockedNavigation } from "../browser/network-policy.ts";
import type { TargetDescription } from "../browser/page-helpers.ts";
import type { ModelScreenshot } from "../browser/screenshot.ts";
import type { BrowserStorageState, CollectedStorage } from "../browser/storage-state.ts";
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
  /** The approval a function call needs, asked of the tool against the page as it is now. */
  functionApproval(
    name: FunctionToolName,
    args: unknown,
    signal: AbortSignal,
  ): Promise<ApprovalRequest | null>;
  runFunction(
    name: FunctionToolName,
    args: unknown,
    signal: AbortSignal,
    approval: CallApproval | null,
  ): Promise<ToolRun>;
  navigate(url: string, signal: AbortSignal): Promise<boolean>;
  restoreView(view: { scroll: ScrollPosition | null; videoTime: number | null }): Promise<void>;
  drainBlockedNavigations(): BlockedNavigation[];
  /** Downloads the page tried to start since the last call: each was cancelled (spec §9). */
  drainBlockedDownloads(): BlockedDownload[];
  /** A person approved this download: its next start is saved to the run's folder, once. */
  allowDownload(url: string): Promise<void>;
  collectStorage(): Promise<CollectedStorage>;
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
