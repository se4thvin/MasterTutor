import { Uuid } from "@mastertutor/contracts";
import { RETENTION_DAYS, TRACE_STREAM } from "@mastertutor/contracts/telemetry";
import { RunTracesArgs } from "@mastertutor/observer/copilot";
import type { O2Query } from "../o2.ts";
import { invalid, type ToolFn } from "./types.ts";

/** Server-written SQL only: the run id comes from the handle map, never from the model (spec §7.5). */
export const runTraces =
  (o2: O2Query): ToolFn =>
  async (raw, ctx) => {
    const args = RunTracesArgs.safeParse(raw);
    if (!args.success) return invalid(args.error.issues.map((i) => i.message).join("; "));
    const runId = ctx.handles.runIdOf(args.data.run);
    if (!runId) return invalid(`Unknown run handle ${args.data.run}; use runs_find first.`);
    Uuid.parse(runId);
    const sql = `SELECT trace_id, operation_name, duration, span_status, mt_error_code, mt_step_phase FROM "${TRACE_STREAM}" WHERE mt_run_id = '${runId}' ORDER BY duration DESC LIMIT ${args.data.limit}`;
    const endUs = Date.now() * 1_000;
    const table = await o2.search(
      TRACE_STREAM,
      sql,
      { startUs: endUs - RETENTION_DAYS.traces * 86_400_000_000, endUs },
      args.data.limit,
      ctx.signal,
    );
    return {
      summary: `${args.data.run} traces`,
      query: { run: args.data.run },
      columns: table.columns,
      rows: table.rows.map((row) =>
        row.map((c) => (typeof c === "string" ? ctx.handles.replaceUuids(c) : c)),
      ),
      truncated: table.truncated,
      tainted: true,
      outcome: "ok",
      error: null,
      chart: null,
    };
  };
