import { LOG_STREAMS, TRACE_STREAM } from "@mastertutor/contracts/telemetry";
import type { QueryCheck } from "./promql.ts";

export const COPILOT_STREAMS = [LOG_STREAMS.app, LOG_STREAMS.containers, TRACE_STREAM] as const;
export type CopilotStream = (typeof COPILOT_STREAMS)[number];

const WRITE =
  /\b(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|attach|detach|set|pragma|call)\b/i;
const MAX_SQL = 4_000;

/**
 * OpenObserve SQL is the only free-form query the model writes, and only against the stream it
 * names; the server sets the time range and size (spec §7.4). A structural guard, conservative by
 * design: string literals are blanked first so their contents never count.
 */
export function checkSql(sql: string, stream: CopilotStream): QueryCheck {
  const text = sql.trim();
  if (text.length === 0 || text.length > MAX_SQL)
    return { ok: false, error: `SQL must be 1–${MAX_SQL} characters.` };
  const code = text.replace(/'(?:[^']|'')*'/g, "''");
  if (code.includes(";")) return { ok: false, error: "One statement only; no semicolons." };
  if (/--|\/\*/.test(code)) return { ok: false, error: "No comments." };
  if (!/^select\b/i.test(code)) return { ok: false, error: "Only a single SELECT is allowed." };
  if (
    (code.match(/\bselect\b/gi) ?? []).length !== 1 ||
    /\b(union|intersect|except|with)\b/i.test(code)
  )
    return { ok: false, error: "No subqueries or set operations." };
  if (WRITE.test(code)) return { ok: false, error: "Read-only queries only." };
  // No aliases or qualification: the one stream is followed only by a SELECT clause.
  const source = /\bfrom\s+(?:"([A-Za-z0-9_]+)"|([A-Za-z0-9_]+))(?=\s|$)/i.exec(code);
  if (!source || (source[1] ?? source[2]) !== stream)
    return { ok: false, error: `Query only FROM "${stream}".` };
  const tail = code.slice(source.index + source[0].length).trim();
  if (tail && !/^(where|group\s+by|order\s+by|limit|offset|having)\b/i.test(tail))
    return { ok: false, error: "Exactly one unqualified stream, no joins or comma sources." };
  const sources = [...code.matchAll(/\b(?:from|join)\s+("?)([A-Za-z0-9_]+)\1/gi)].map(
    (match) => match[2],
  );
  if (sources.length === 0 || sources.some((source) => source !== stream))
    return { ok: false, error: `Query only FROM "${stream}", with no joins to other streams.` };
  if (/\bjoin\b/i.test(code)) return { ok: false, error: "No joins." };
  return { ok: true };
}
