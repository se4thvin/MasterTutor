import type { ApprovalRequest, FunctionToolName, RunEvent, Usage } from "@mastertutor/contracts";
import type { DbTx } from "@mastertutor/db";
import type { z } from "zod";
import type { MaskSources } from "../browser/masking.ts";
import type { BrowserSession } from "../browser/session.ts";
import type { Log } from "../runtime/types.ts";

/** The decision that cleared this exact call (same call id and arguments) for execution. */
export interface CallApproval {
  /** The approval request's kind, e.g. "credential_first_use". */
  kind: string;
  /** The deciding user's id, or POLICY_DECIDER for auto mode. */
  decidedBy: string;
  /**
   * What the approved card named beyond its kind, so the tool can check it still holds at act
   * time (credential_first_use: the form destination it showed, or null when it showed none).
   */
  label: string | null;
  /** When it was decided (ms since the epoch), or null on decisions recorded before this field. */
  decidedAt: number | null;
}

/** What a tool may look at in the approve phase, before anything acts. */
export interface ApprovalContext {
  runId: string;
  workspaceId: string;
  session: BrowserSession;
  signal: AbortSignal;
  log: Log;
}

/**
 * What a tool stages for its step's single commit (spec §5.3). Writes run inside the commit
 * transaction in call order, then events; after-commit tasks run once it resolved. Objects a tool
 * uploads are owned by the step: a failed or discarded step deletes them (preflight F17).
 */
export interface StepWriter {
  defer(write: (tx: DbTx) => Promise<void>): void;
  emit(event: RunEvent): void;
  afterCommit(task: () => Promise<void>): void;
  ownObject(key: string): void;
  /** OCR, filing, embedding and transcription spend (preflight F16). */
  addUsage(delta: Usage): void;
  /**
   * USD the run's budget still allows, after this step's own spend: a tool that spends as it goes
   * (transcription) checks it before each spend, since the loop checks the budget only between steps.
   */
  usdLeft(): number;
}

export interface ToolContext {
  runId: string;
  workspaceId: string;
  session: BrowserSession;
  signal: AbortSignal;
  log: Log;
  /** Spec §5.3 approve → act: the decision for this call, or null when it needed none. */
  approval: CallApproval | null;
  /** Asks the loop to enter waiting(reason) once this act step commits (spec §9 OTP). */
  requestWait(reason: "otp"): void;
  /**
   * Only a person can decide what this call needed (shown as the reason): once this act commits
   * the run waits for a takeover and the rest of the turn does not run.
   */
  requestHandOver(reason: string): void;
  /** This act's staged writes, committed with it (B2 seam F2). */
  step: StepWriter;
  /** The run's vault mask sources (B3): stored screenshots are masked, secrets never persisted. */
  mask: MaskSources;
  /** The leased slot ("browser-N"), for slot-local services such as Pulse audio. */
  slotName: string;
}

/**
 * A typed tool failure. `code` and the tool-written `message` reach the model; nothing page-derived
 * ever does (spec §6). The step's staged writes are discarded.
 */
export class ToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    if (!/^[a-z][a-z_]{0,39}$/.test(code)) throw new TypeError(`invalid tool error code ${code}`);
    super(message.slice(0, 200));
    this.name = "ToolError";
    this.code = code;
  }
}

/** Spec §3.3 `tools`: one function tool. `untrusted` results carry page-derived text. */
export interface Tool<A, R> {
  name: FunctionToolName;
  args: z.ZodType<A>;
  result: z.ZodType<R>;
  untrusted: boolean;
  run(ctx: ToolContext, args: A): Promise<R>;
  /**
   * Spec §5.3 approve phase: the approval this call needs, from the page as it is now, or null.
   * The tool re-checks at act time that what was approved still holds.
   */
  approval?(ctx: ApprovalContext, args: A): Promise<ApprovalRequest | null>;
}

export interface RegisteredTool {
  name: FunctionToolName;
  untrusted: boolean;
  invoke(ctx: ToolContext, rawArgs: unknown): Promise<unknown>;
  /** Null when the call needs no approval, or when its arguments are invalid (it is refused then). */
  approval(ctx: ApprovalContext, rawArgs: unknown): Promise<ApprovalRequest | null>;
}

/** Erases the generics: args and results are validated at the boundary in both directions. */
export function register<A, R>(tool: Tool<A, R>): RegisteredTool {
  return {
    name: tool.name,
    untrusted: tool.untrusted,
    invoke: async (ctx, rawArgs) =>
      tool.result.parse(await tool.run(ctx, tool.args.parse(rawArgs))),
    approval: async (ctx, rawArgs) => {
      const args = tool.args.safeParse(rawArgs);
      return args.success && tool.approval ? tool.approval(ctx, args.data) : null;
    },
  };
}
