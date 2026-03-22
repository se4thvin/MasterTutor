import type { FunctionToolName } from "@mastertutor/contracts";
import type { z } from "zod";
import type { BrowserSession } from "../browser/session.ts";
import type { Log } from "../runtime/types.ts";

/** The decision that cleared this exact call (same call id and arguments) for execution. */
export interface CallApproval {
  /** The approval request's kind, e.g. "credential_first_use". */
  kind: string;
  /** The deciding user's id, or POLICY_DECIDER for auto mode. */
  decidedBy: string;
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
}

export interface RegisteredTool {
  name: FunctionToolName;
  untrusted: boolean;
  invoke(ctx: ToolContext, rawArgs: unknown): Promise<unknown>;
}

/** Erases the generics: args and results are validated at the boundary in both directions. */
export function register<A, R>(tool: Tool<A, R>): RegisteredTool {
  return {
    name: tool.name,
    untrusted: tool.untrusted,
    invoke: async (ctx, rawArgs) =>
      tool.result.parse(await tool.run(ctx, tool.args.parse(rawArgs))),
  };
}
