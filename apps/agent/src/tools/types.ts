import type { FunctionToolName } from "@mastertutor/contracts";
import type { z } from "zod";
import type { BrowserSession } from "../browser/session.ts";
import type { Log } from "../runtime/types.ts";

export interface ToolContext {
  runId: string;
  workspaceId: string;
  session: BrowserSession;
  signal: AbortSignal;
  log: Log;
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
