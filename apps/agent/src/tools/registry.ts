import { toOrigin, type FunctionToolName } from "@mastertutor/contracts";
import { wrapUntrusted } from "../guardrails/untrusted.ts";
import { StaleRef, interruptionOf } from "../runtime/errors.ts";
import type { Log } from "../runtime/types.ts";
import type { RegisteredTool, ToolContext } from "./types.ts";

export interface ToolRun {
  output: string;
  /** True when the tool wrote note blocks (capture, annotate, video), which counts as progress. */
  notesChanged: boolean;
}

function wroteBlocks(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const record = result as { blockIds?: unknown; blockId?: unknown };
  return (
    (Array.isArray(record.blockIds) && record.blockIds.length > 0) ||
    typeof record.blockId === "string"
  );
}

export class ToolRegistry {
  readonly #tools = new Map<FunctionToolName, RegisteredTool>();
  readonly #log: Log;

  constructor(tools: readonly RegisteredTool[], log: Log) {
    for (const tool of tools) this.#tools.set(tool.name, tool);
    this.#log = log;
  }

  async run(name: FunctionToolName, args: unknown, ctx: ToolContext): Promise<ToolRun> {
    const tool = this.#tools.get(name);
    if (!tool)
      return { output: JSON.stringify({ error: "tool_unavailable" }), notesChanged: false };
    try {
      const result = await tool.invoke(ctx, args);
      const text = JSON.stringify(result);
      const output = tool.untrusted ? wrapUntrusted(toOrigin(ctx.session.page.url()), text) : text;
      return { output, notesChanged: wroteBlocks(result) };
    } catch (error) {
      if (interruptionOf(error) !== null || ctx.signal.aborted) throw error;
      if (error instanceof StaleRef)
        return { output: JSON.stringify({ error: "stale_ref" }), notesChanged: false };
      this.#log.warn({ runId: ctx.runId, tool: name, errorCode: "tool_failed" }, "tool failed");
      return { output: JSON.stringify({ error: "tool_failed" }), notesChanged: false };
    }
  }
}
