import type {
  ApprovalRequest,
  ComputerAction,
  FunctionToolName,
  ScrollPosition,
} from "@mastertutor/contracts";
import type { CDPSession } from "playwright-core";
import type { ControlGuard } from "../browser/guard.ts";
import type { BlockedDownload } from "../browser/download-gate.ts";
import type { BlockedNavigation } from "../browser/network-policy.ts";
import type { TargetDescription } from "../browser/page-helpers.ts";
import type { ModelScreenshot } from "../browser/screenshot.ts";
import type { BrowserSession } from "../browser/session.ts";
import type { BrowserStorageState, CollectedStorage } from "../browser/storage-state.ts";
import type { ActionGate, ComputerRun } from "../tools/computer.ts";
import type { ToolRun } from "../tools/registry.ts";
import type { CallApproval, StepWriter } from "../tools/types.ts";
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
    /** The act's staged writes; a function tool's note writes join its commit (B2 seam F2). */
    step: StepWriter,
  ): Promise<ToolRun>;
  navigate(url: string, signal: AbortSignal): Promise<boolean>;
  restoreView(view: { scroll: ScrollPosition | null; videoTime: number | null }): Promise<void>;
  drainBlockedNavigations(): BlockedNavigation[];
  /** Downloads the page tried to start since the last call: each was cancelled (spec §9). */
  drainBlockedDownloads(): BlockedDownload[];
  /**
   * The download a `download` card showed was approved: the next download that would make the
   * same card (a script's blob or data URL may differ in its id) is saved to the run's folder, once.
   */
  allowDownload(card: { url: string; filename: string | null; approvedBy: string }): Promise<void>;
  collectStorage(): Promise<CollectedStorage>;
  applyStorage(state: BrowserStorageState): Promise<() => Promise<void>>;
}

export interface AttachedBrowser {
  browser: LoopBrowser;
  /** The page session for lease hooks (B3 passkey enrolment); null for fakes. */
  session: BrowserSession | null;
  /** Browser-level CDP for lease hooks (RunHooks.onLeased). */
  browserCdp(): Promise<CDPSession>;
  close(): Promise<void>;
}

export type ConnectBrowser = (options: {
  slotName: string;
  run: () => RunSnapshot;
  guard: ControlGuard;
}) => Promise<AttachedBrowser>;
