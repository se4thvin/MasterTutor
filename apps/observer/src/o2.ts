import { COPILOT_LIMITS, type ObserverTable } from "@mastertutor/contracts";
import {
  O2RangeResponse,
  O2SearchBody,
  O2SearchResponse,
  o2QueryPaths,
  type O2Client,
} from "@mastertutor/observability/query";

export type Table = ObserverTable;
export type Cell = Table["rows"][number][number];
export interface O2Query {
  search(
    stream: string,
    sql: string,
    range: { startUs: number; endUs: number },
    size: number,
    signal: AbortSignal,
  ): Promise<Table & { took: number; scanSize: number | null }>;
  range(
    query: string,
    range: { start: number; end: number; step: number },
    signal: AbortSignal,
  ): Promise<Table>;
}

const MAX_COLUMNS = COPILOT_LIMITS.columns;
const MAX_CELL = COPILOT_LIMITS.cellChars;
const cell = (value: unknown): Cell => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || typeof value === "boolean") return value;
  return String(typeof value === "object" ? JSON.stringify(value) : value).slice(0, MAX_CELL);
};

/** Preserve each column's identity even when long metric labels share a prefix. */
const columnNames = (names: string[]): string[] => {
  const used = new Set<string>();
  return names.map((name) => {
    let out = name.slice(0, COPILOT_LIMITS.columnChars) || "value";
    let count = 1;
    while (used.has(out)) {
      const suffix = `#${++count}`;
      out = `${name.slice(0, COPILOT_LIMITS.columnChars - suffix.length)}${suffix}`;
    }
    used.add(out);
    return out;
  });
};

/** The only two OpenObserve calls the Copilot makes (spec §7.4), through our proxy client. */
export function createO2Query(client: O2Client): O2Query {
  return {
    async search(stream, sql, range, size, signal) {
      const body = O2SearchBody.parse({
        query: { sql, start_time: range.startUs, end_time: range.endUs, from: 0, size },
        timeout: COPILOT_LIMITS.queryTimeoutMs / 1_000,
      });
      const type = stream === "default" ? "traces" : "logs";
      const reply = O2SearchResponse.parse(
        await client.call(
          "search",
          "POST",
          o2QueryPaths.search(client.org, type),
          body,
          undefined,
          { signal },
        ),
      );
      const keys = [...new Set(reply.hits.flatMap((hit) => Object.keys(hit)))];
      const selected = keys.slice(0, MAX_COLUMNS);
      return {
        columns: columnNames(selected),
        rows: reply.hits
          .slice(0, Math.min(size, COPILOT_LIMITS.storedRows))
          .map((hit) => selected.map((key) => cell(hit[key] ?? null))),
        truncated:
          reply.hits.length >= size ||
          (reply.total ?? 0) > reply.hits.length ||
          keys.length > MAX_COLUMNS,
        took: Math.max(0, Math.round(reply.took)),
        scanSize: reply.scan_size ?? null,
      };
    },
    async range(query, range, signal) {
      const reply = O2RangeResponse.parse(
        await client.call(
          "query_range",
          "GET",
          o2QueryPaths.queryRange(client.org, { query, ...range }),
          undefined,
          undefined,
          { signal },
        ),
      );
      if (reply.status !== "success" || reply.data.resultType !== "matrix")
        throw new Error("invalid_o2_range");
      const series = reply.data.result.slice(0, COPILOT_LIMITS.series);
      const names = series.map(
        (s) =>
          Object.entries(s.metric)
            .map(([key, value]) => `${key}=${value}`)
            .join(",") || "value",
      );
      const times = [...new Set(series.flatMap((s) => s.values.map(([time]) => time)))].sort(
        (a, b) => a - b,
      );
      const byTime = series.map(
        (s) => new Map(s.values.map(([time, value]) => [time, cell(Number(value))])),
      );
      const limit = Math.min(COPILOT_LIMITS.points, COPILOT_LIMITS.storedRows);
      return {
        columns: columnNames(["time", ...names]),
        rows: times
          .slice(0, limit)
          .map((time) => [time, ...byTime.map((values) => values.get(time) ?? null)]),
        truncated: reply.data.result.length > COPILOT_LIMITS.series || times.length > limit,
      };
    },
  };
}
