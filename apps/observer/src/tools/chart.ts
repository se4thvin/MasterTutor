import { RenderChartArgs } from "@mastertutor/observer/copilot";
import { invalid, type ToolFn } from "./types.ts";

/** No backend: the spec is checked against the stored result; the UI draws from stored rows. */
export const renderChart = (): ToolFn => async (raw, ctx) => {
  const args = RenderChartArgs.safeParse(raw);
  if (!args.success) return invalid(args.error.issues.map((i) => i.message).join("; "));
  const result = ctx.results.get(args.data.resultId);
  if (!result) return invalid(`No result ${args.data.resultId} in this conversation.`);
  const missing = [args.data.x, ...args.data.y].filter((c) => !result.columns.includes(c));
  if (missing.length > 0)
    return invalid(
      `Columns not in ${args.data.resultId}: ${missing.join(", ")}. Columns: ${result.columns.join(", ")}.`,
    );
  return {
    summary: `chart of ${args.data.resultId}`,
    query: { ...args.data },
    columns: [],
    rows: [],
    truncated: false,
    tainted: false,
    outcome: "ok",
    error: null,
    chart: args.data,
  };
};
