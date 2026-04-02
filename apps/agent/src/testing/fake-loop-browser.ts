import {
  toOrigin,
  type ApprovalRequest,
  type ComputerAction,
  type FunctionToolName,
  type ScrollPosition,
} from "@mastertutor/contracts";
import type { ControlGuard } from "../browser/guard.ts";
import type { BlockedNavigation } from "../browser/network-policy.ts";
import type { TargetDescription } from "../browser/page-helpers.ts";
import type { CollectedStorage } from "../browser/storage-state.ts";
import type { LoopBrowser, Observation } from "../loop/loop-browser.ts";
import type { ActionGate, ComputerRun } from "../tools/computer.ts";
import type { ToolRun } from "../tools/registry.ts";
import type { CallApproval } from "../tools/types.ts";

export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
export const PLAIN_TARGET: TargetDescription = {
  label: "",
  tag: "div",
  path: "div",
  context: "page",
  isFormSubmit: false,
  formKind: null,
  isSecretField: false,
  editable: true,
  interactive: false,
};

/** A scriptable LoopBrowser for loop and worker tests (no Chromium). */
export class FakeLoopBrowser implements LoopBrowser {
  url = "http://site.fixtures.test/";
  title = "Fixture";
  domHash = "d".repeat(64);
  captcha = false;
  phash = 1n;
  png: Buffer = TINY_PNG;
  scroll: ScrollPosition = { x: 0, y: 0 };
  readonly targets = new Map<string, TargetDescription>();
  /** What has keyboard focus, for keypress/type targets at act time (null: PLAIN_TARGET). */
  focused: TargetDescription | null = null;
  /** Batches that ran to the end (every action passed the gate). */
  readonly computerRuns: ComputerAction[][] = [];
  /** What the gate answered for each action it was asked about. */
  readonly verdicts: Array<Awaited<ReturnType<ActionGate>>> = [];
  /** Every single action that passed the gate, including those of a batch stopped later. */
  readonly executed: ComputerAction[] = [];
  readonly functionRuns: Array<{ name: string; args: unknown }> = [];
  /** The approval each function call was run with (F4). */
  readonly functionApprovals: Array<CallApproval | null> = [];
  /** A wait a function call asks for, e.g. "otp" for fill_credential without a code. */
  functionWait: (name: FunctionToolName) => "otp" | null = () => null;
  /** A hand-over a function call asks for (the reason shown), e.g. fill_credential's needs_human. */
  functionHandOver: (name: FunctionToolName) => string | null = () => null;
  readonly navigations: string[] = [];
  blocked: BlockedNavigation[] = [];
  /** Runs after each single action, e.g. to change what lies under a later action of the batch. */
  actionHook: ((action: ComputerAction) => void | Promise<void>) | null = null;
  /** True for an action the gate allowed but the executor still refuses when it presses. */
  dispatchHold: ((action: ComputerAction) => boolean) | null = null;
  /** Download attempts the page made (drained by the loop), and the downloads a person allowed. */
  blockedDownloads: Array<{ url: string; filename: string | null }> = [];
  allowedDownloads: string[] = [];
  /** The executor hands the page to the user at this action (returns the reason), or null. */
  handOverOn: ((action: ComputerAction) => string | null) | null = null;
  /** The worker's control guard, checked before every input and screenshot like the real session. */
  guard: ControlGuard | null = null;
  /** How often the storage-state restore script was removed again. */
  restoreRemovals = 0;
  computerHook:
    ((actions: readonly ComputerAction[], signal: AbortSignal) => Promise<void>) | null = null;
  functionOutput = (name: string): string => JSON.stringify({ ok: true, tool: name });

  async observe(signal: AbortSignal): Promise<Observation> {
    signal.throwIfAborted();
    this.guard?.assertAgent(signal);
    return {
      url: this.url,
      title: this.title,
      origin: new URL(this.url).origin,
      domHash: this.domHash,
      screenshot: { png: this.png, width: 1, height: 1, scale: 1, masked: 0, dropped: false },
      phash: this.phash,
      captcha: this.captcha,
      scroll: { ...this.scroll },
      videoTime: null,
    };
  }

  async targetFor(
    action: ComputerAction,
    previous: TargetDescription | null,
  ): Promise<TargetDescription | null> {
    if (action.type === "click" || action.type === "double_click")
      return this.targets.get(`${action.x},${action.y}`) ?? PLAIN_TARGET;
    if (action.type === "type" || action.type === "keypress")
      return previous ?? this.focused ?? PLAIN_TARGET;
    return null;
  }

  async runComputer(
    actions: readonly ComputerAction[],
    signal: AbortSignal,
    gate: ActionGate,
  ): Promise<ComputerRun> {
    let executed = 0;
    for (const action of actions) {
      const verdict = await gate(action);
      this.verdicts.push(verdict);
      if (!verdict)
        return {
          executed,
          notes: ["Stopped before an action: it needs approval."],
          handOver: null,
        };
      // The executor's own hold at the moment it presses (B1 round 5): allowed, yet not run.
      if (this.dispatchHold?.(action))
        return {
          executed,
          notes: ["Stopped before an action: its target changed."],
          handOver: null,
        };
      // A page the executor cannot act on safely even with approval (B1 breaker fix 2).
      const handOver = this.handOverOn?.(action) ?? null;
      if (handOver)
        return { executed: executed + 1, notes: ["Nothing was clicked: handed over."], handOver };
      this.guard?.assertAgent(signal);
      this.executed.push(action);
      executed += 1;
      await this.actionHook?.(action);
    }
    this.computerRuns.push([...actions]);
    await this.computerHook?.(actions, signal);
    return { executed, notes: [], handOver: null };
  }

  /** The approval request a function call raises in the approve phase (none by default). */
  functionApproval: (name: FunctionToolName, args: unknown) => Promise<ApprovalRequest | null> =
    async () => null;

  async runFunction(
    name: FunctionToolName,
    args: unknown,
    signal: AbortSignal,
    approval: CallApproval | null,
  ): Promise<ToolRun> {
    signal.throwIfAborted();
    this.functionRuns.push({ name, args });
    this.functionApprovals.push(approval);
    return {
      output: this.functionOutput(name),
      notesChanged: false,
      wait: this.functionWait(name),
      handOver: this.functionHandOver(name),
    };
  }

  /** Runs inside navigate, e.g. to block a restore navigation until it is aborted. */
  navigateHook: ((signal: AbortSignal) => Promise<void>) | null = null;

  async navigate(url: string, signal: AbortSignal): Promise<boolean> {
    await this.navigateHook?.(signal);
    this.navigations.push(url);
    this.url = url;
    return true;
  }

  async restoreView(): Promise<void> {}

  drainBlockedNavigations(): BlockedNavigation[] {
    return this.blocked.splice(0);
  }

  drainBlockedDownloads() {
    return this.blockedDownloads.splice(0);
  }

  async allowDownload(url: string): Promise<void> {
    this.allowedDownloads.push(url);
  }

  async collectStorage(): Promise<CollectedStorage> {
    return {
      state: { cookies: [], origins: [] },
      page: { origin: toOrigin(this.url), passwordFieldVisible: false },
    };
  }

  async applyStorage(): Promise<() => Promise<void>> {
    return async () => {
      this.restoreRemovals += 1;
    };
  }
}
