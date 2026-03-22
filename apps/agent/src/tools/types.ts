import type { ApprovalRequest, FunctionToolName } from "@mastertutor/contracts";
import type { z } from "zod";
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
