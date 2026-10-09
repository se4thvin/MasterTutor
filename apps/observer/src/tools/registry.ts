import { COPILOT_LIMITS, COPILOT_TOOL_NAMES, type CopilotToolName } from "@mastertutor/contracts";
import type { DbLike } from "@mastertutor/db";
import type { CodeIndex } from "../code-index.ts";
import type { O2Query } from "../o2.ts";
import { renderChart } from "./chart.ts";
import { codeRead, codeSearch } from "./code.ts";
import { metricsQuery } from "./metrics.ts";
import { runDetailTool, runsFind } from "./runs.ts";
import { telemetrySearch } from "./telemetry-search.ts";
import { runTraces } from "./traces.ts";
import type { ToolFn } from "./types.ts";

export function createToolRegistry(deps: {
  db: DbLike;
  o2: O2Query;
  code: CodeIndex;
}): Record<CopilotToolName, ToolFn> {
  const tools: Record<CopilotToolName, ToolFn> = {
    metrics_query: metricsQuery(deps.o2),
    telemetry_search: telemetrySearch(deps.o2),
    runs_find: runsFind(deps.db),
    run_detail: runDetailTool(deps.db),
    run_traces: runTraces(deps.o2),
    code_search: codeSearch(deps.code),
    code_read: codeRead(deps.code),
    render_chart: renderChart(),
  };
  for (const name of COPILOT_TOOL_NAMES) {
    const run = tools[name];
    tools[name] = async (args, ctx) => {
      ctx.signal.throwIfAborted();
      const result = await run(args, ctx);
      const columns = result.columns.slice(0, COPILOT_LIMITS.columns);
      return {
        ...result,
        summary: result.summary.slice(0, COPILOT_LIMITS.summaryChars),
        columns,
        rows: result.rows
          .slice(0, COPILOT_LIMITS.storedRows)
          .map((row) =>
            row
              .slice(0, columns.length)
              .map((cell) =>
                typeof cell === "string"
                  ? ctx.handles.replaceUuids(cell).slice(0, COPILOT_LIMITS.cellChars)
                  : typeof cell === "number" && !Number.isFinite(cell)
                    ? null
                    : cell,
              ),
          ),
        truncated:
          result.truncated ||
          result.rows.length > COPILOT_LIMITS.storedRows ||
          result.columns.length > columns.length,
      };
    };
  }
  return tools;
}
