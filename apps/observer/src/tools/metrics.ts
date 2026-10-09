import { COPILOT_LIMITS } from "@mastertutor/contracts";
import { MetricsQueryArgs } from "@mastertutor/observer/copilot";
import type { O2Query } from "../o2.ts";
import { checkPromql } from "../queries/promql.ts";
import { invalid, type ToolFn } from "./types.ts";

export const metricsQuery =
  (o2: O2Query): ToolFn =>
  async (raw, ctx) => {
    const args = MetricsQueryArgs.safeParse(raw);
    if (!args.success) return invalid(args.error.issues.map((i) => i.message).join("; "));
    const check = checkPromql(args.data.promql);
    if (!check.ok) return invalid(check.error, { promql: args.data.promql });
    const hours = Math.min(
      args.data.rangeHours ?? COPILOT_LIMITS.metricDefaultHours,
      COPILOT_LIMITS.metricMaxHours,
    );
    const end = Math.floor(Date.now() / 1_000);
    const start = end - hours * 3_600;
    // The server picks the step: at most 300 points per series, whatever the model asked for.
    const step = Math.max(
      args.data.stepSeconds ?? 15,
      Math.ceil((end - start) / (COPILOT_LIMITS.points - 1)),
    );
    const table = await o2.range(args.data.promql, { start, end, step }, ctx.signal);
    return {
      summary: `metrics ${hours} h`,
      query: { promql: args.data.promql, start, end, step },
      ...table,
      tainted: false,
      outcome: "ok",
      error: null,
      chart: null,
    };
  };
