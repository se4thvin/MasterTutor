import { COPILOT_LIMITS } from "@mastertutor/contracts";
import { LOG_STREAMS } from "@mastertutor/contracts/telemetry";
import { TelemetrySearchArgs } from "@mastertutor/observer/copilot";
import type { O2Query } from "../o2.ts";
import { checkSql } from "../queries/sql.ts";
import { invalid, type ToolFn } from "./types.ts";

const HOUR_US = 3_600_000_000;

export const telemetrySearch =
  (o2: O2Query): ToolFn =>
  async (raw, ctx) => {
    const args = TelemetrySearchArgs.safeParse(raw);
    if (!args.success) return invalid(args.error.issues.map((i) => i.message).join("; "));
    const check = checkSql(args.data.sql, args.data.stream);
    if (!check.ok) return invalid(check.error, { stream: args.data.stream, sql: args.data.sql });
    const hours = Math.min(
      args.data.rangeHours ?? COPILOT_LIMITS.searchDefaultHours,
      COPILOT_LIMITS.searchMaxHours,
    );
    const endUs = Date.now() * 1_000;
    const range = { startUs: endUs - hours * HOUR_US, endUs };
    const table = await o2.search(
      args.data.stream,
      args.data.sql,
      range,
      COPILOT_LIMITS.storedRows,
      ctx.signal,
    );
    return {
      summary: `${args.data.stream} ${hours} h · ${table.took} ms`,
      query: { stream: args.data.stream, sql: args.data.sql, ...range },
      columns: table.columns,
      rows: table.rows.map((row) =>
        row.map((c) => (typeof c === "string" ? ctx.handles.replaceUuids(c) : c)),
      ),
      truncated: table.truncated,
      // Container logs echo page-controlled strings (CP §3.1): always untrusted.
      tainted: args.data.stream === LOG_STREAMS.containers,
      outcome: "ok",
      error: null,
      chart: null,
    };
  };
