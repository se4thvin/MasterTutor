import {
  isToolInProfile,
  toOrigin,
  type FunctionToolName,
  type ToolProfile,
  wrapUntrusted,
} from "@mastertutor/contracts";
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { instrument, type ProductSpan } from "@mastertutor/telemetry/instrument";
import { NO_MASK_SOURCES, redactDeep, type MaskSources } from "../browser/masking.ts";
import { StaleRef, interruptionOf } from "../runtime/errors.ts";
import type { Log } from "../runtime/types.ts";
import type { ApprovalRequest } from "@mastertutor/contracts";
import { ToolError, type ApprovalContext, type RegisteredTool, type ToolContext } from "./types.ts";

export interface ToolRun {
  output: string;
  /** True when the tool wrote note blocks (capture, video), which counts as progress. */
  notesChanged: boolean;
  /** True when the tool answered with an error: the loop discards its staged step writes. */
  failed: boolean;
  /** The tool asked the loop to wait for the user (spec §9: a one-time code), else null. */
  wait: "otp" | null;
  /** The tool asked to hand the page to a person (the reason to show), else null. */
  handOver: string | null;
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
  readonly #mask: MaskSources;

  constructor(tools: readonly RegisteredTool[], log: Log, mask: MaskSources = NO_MASK_SOURCES) {
    for (const tool of tools) this.#tools.set(tool.name, tool);
    this.#log = log;
    this.#mask = mask;
  }

  /** The approve phase's question for one call (spec §5.3), or null when it needs none. */
  async approval(
    name: FunctionToolName,
    args: unknown,
    ctx: ApprovalContext,
  ): Promise<ApprovalRequest | null> {
    return (await this.#tools.get(name)?.approval(ctx, args)) ?? null;
  }

  /** Seam 3 (spec §7.3): one mt.tool span per function call. */
  run(
    name: FunctionToolName,
    args: unknown,
    ctx: Omit<ToolContext, "requestWait" | "requestHandOver">,
  ): Promise<ToolRun> {
    return instrument(
      SPAN.tool,
      { [ATTR.runId]: ctx.runId, [ATTR.toolName]: name },
      (span) => this.#invoke(name, args, ctx, span),
      { expected: interruptionOf },
    );
  }

  async #invoke(
    name: FunctionToolName,
    args: unknown,
    ctx: Omit<ToolContext, "requestWait" | "requestHandOver">,
    span: ProductSpan,
  ): Promise<ToolRun> {
    const tool = this.#tools.get(name);
    if (!tool) {
      span.set({ [ATTR.toolOutcome]: "unavailable" });
      return {
        output: JSON.stringify({ error: "tool_unavailable" }),
        notesChanged: false,
        failed: true,
        wait: null,
        handOver: null,
      };
    }
    let wait: "otp" | null = null;
    let handOver: string | null = null;
    const requestHandOver = (reason: string) => {
      handOver ??= reason.slice(0, 300);
    };
    const requestWait = (reason: "otp") => {
      wait = reason;
    };
    try {
      const raw = await tool.invoke({ ...ctx, requestWait, requestHandOver }, args);
      // M13: a page can reflect a vault secret into its text; no tool result carries it out.
      const result = redactDeep(raw, this.#mask);
      const text = JSON.stringify(result);
      const output = tool.untrusted ? wrapUntrusted(toOrigin(ctx.session.page.url()), text) : text;
      const declared = tool.telemetry?.(args, raw) ?? {};
      const declaredError = declared[ATTR.errorCode];
      span.set({ ...declared, [ATTR.toolOutcome]: declaredError ? "tool_error" : "ok" });
      if (declaredError) span.fail(declaredError);
      return { output, notesChanged: wroteBlocks(result), failed: false, wait, handOver };
    } catch (error) {
      if (interruptionOf(error) !== null || ctx.signal.aborted) throw error;
      if (error instanceof ToolError) {
        span.set({ [ATTR.toolOutcome]: "tool_error" });
        span.fail(error.code);
        return {
          // Tool-written, but a message can quote what it looked for: redacted all the same (M4).
          output: JSON.stringify({ error: error.code, message: this.#mask.redact(error.message) }),
          notesChanged: false,
          failed: true,
          wait: null,
          handOver: null,
        };
      }
      if (error instanceof StaleRef) {
        span.set({ [ATTR.toolOutcome]: "stale_ref" });
        span.fail("stale_ref");
        return {
          output: JSON.stringify({ error: "stale_ref" }),
          notesChanged: false,
          failed: true,
          wait: null,
          handOver: null,
        };
      }
      span.set({ [ATTR.toolOutcome]: "failed" });
      span.fail("tool_failed");
      this.#log.warn({ runId: ctx.runId, tool: name, errorCode: "tool_failed" }, "tool failed");
      return {
        output: JSON.stringify({ error: "tool_failed" }),
        notesChanged: false,
        failed: true,
        wait: null,
        handOver: null,
      };
    }
  }
}

/**
 * The run's function tools (Phase 10). A tool outside the profile is never registered, so a
 * hallucinated call to it answers {"error":"tool_unavailable"} in code, not by prompt.
 */
export function profileTools(
  profile: ToolProfile,
  tools: readonly RegisteredTool[],
): RegisteredTool[] {
  return tools.filter((tool) => isToolInProfile(profile, tool.name));
}
