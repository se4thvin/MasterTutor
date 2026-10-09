import { COPILOT_STREAMS, type CopilotStream } from "@mastertutor/contracts";
import type { QueryCheck } from "./promql.ts";
export { COPILOT_STREAMS, type CopilotStream } from "@mastertutor/contracts";

interface Token {
  kind: "word" | "identifier" | "string" | "symbol";
  value: string;
}

/** Only standard SQL quotes (doubled to escape); reject other dialects rather than guess. */
function tokenize(sql: string): Token[] | null {
  const tokens: Token[] = [];
  for (let i = 0; i < sql.length;) {
    const c = sql[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i) || sql.startsWith("/*", i)) return null;
    if (c === "'" || c === '"') {
      const quote = c;
      let value = "";
      let closed = false;
      i++;
      while (i < sql.length) {
        const next = sql[i++]!;
        if (next === "\\") return null;
        if (next !== quote) {
          value += next;
          continue;
        }
        if (sql[i] === quote) {
          value += quote;
          i++;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed) return null;
      tokens.push({ kind: quote === '"' ? "identifier" : "string", value });
    } else if (/[A-Za-z_]/.test(c)) {
      const start = i++;
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i]!)) i++;
      tokens.push({ kind: "word", value: sql.slice(start, i) });
    } else if (/[0-9(),.*+\-/%=<>!|]/.test(c)) {
      tokens.push({ kind: "symbol", value: c });
      i++;
    } else return null;
  }
  return tokens;
}

const FORBIDDEN = new Set([
  "select",
  "from",
  "join",
  "with",
  "union",
  "intersect",
  "except",
  "into",
  "insert",
  "update",
  "delete",
  "drop",
  "create",
  "alter",
  "truncate",
  "grant",
  "revoke",
  "copy",
  "attach",
  "detach",
  "set",
  "pragma",
  "call",
]);
const CLAUSES = new Set(["where", "group", "order", "limit", "offset", "having"]);
const word = (token: Token | undefined, value: string): boolean =>
  token?.kind === "word" && token.value.toLowerCase() === value;

/**
 * Parse the deliberately small SELECT envelope: one top-level FROM, one bare table, no aliases
 * on the source. Expressions can contain balanced function calls, strings and quoted aliases;
 * no expression may introduce another SELECT/FROM. OpenObserve checks expression semantics.
 */
export function checkSql(sql: string, stream: CopilotStream): QueryCheck {
  const fail = (): QueryCheck => ({
    ok: false,
    error: `One SELECT FROM "${stream}" only; no joins, subqueries, comments or set operations.`,
  });
  if (!sql.trim() || sql.length > 4_000 || !COPILOT_STREAMS.includes(stream)) return fail();
  const tokens = tokenize(sql);
  if (!tokens || !word(tokens[0], "select")) return fail();
  let depth = 0;
  let source = -1;
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind === "symbol") {
      if (token.value === "(") depth++;
      if (token.value === ")" && --depth < 0) return fail();
    }
    if (word(token, "from")) {
      if (depth !== 0 || source !== -1 || i === 1) return fail();
      source = i;
    } else if (token.kind === "word" && FORBIDDEN.has(token.value.toLowerCase())) return fail();
  }
  if (depth !== 0 || source === -1) return fail();
  const table = tokens[source + 1];
  if (!table || !["word", "identifier"].includes(table.kind) || table.value !== stream)
    return fail();
  const after = tokens[source + 2];
  if (after && (after.kind !== "word" || !CLAUSES.has(after.value.toLowerCase()))) return fail();
  return { ok: true };
}
