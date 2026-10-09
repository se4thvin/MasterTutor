import type { ChartSpec, CopilotToolOutcome } from "@mastertutor/contracts";
import type { StoredResult } from "@mastertutor/db";
import type { HandleMap } from "@mastertutor/observer/copilot";
import type { Caller } from "../auth.ts";
import type { Cell } from "../o2.ts";

export interface ToolContext {
  caller: Caller;
  handles: HandleMap;
  /** The question opted in to untrusted text (D52): a tool's own flag alone is not enough. */
  includeUntrusted: boolean;
  results: ReadonlyMap<string, StoredResult>;
  signal: AbortSignal;
}

export interface ToolRun {
  summary: string;
  query: Record<string, unknown>;
  columns: string[];
  rows: Cell[][];
  truncated: boolean;
  tainted: boolean;
  outcome: CopilotToolOutcome;
  /** Sent back to the model so it can correct itself (CP §1); never shown as an answer. */
  error: string | null;
  chart: ChartSpec | null;
}

export type ToolFn = (args: unknown, ctx: ToolContext) => Promise<ToolRun>;

export const invalid = (error: string, query: Record<string, unknown> = {}): ToolRun => ({
  summary: "invalid query",
  query,
  columns: [],
  rows: [],
  truncated: false,
  tainted: false,
  outcome: "invalid",
  error,
  chart: null,
});
