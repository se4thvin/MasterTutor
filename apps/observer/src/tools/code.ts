import { CodeReadArgs, CodeSearchArgs } from "@mastertutor/observer/copilot";
import type { CodeIndex } from "../code-index.ts";
import { invalid, type ToolFn } from "./types.ts";

const ok = (
  summary: string,
  query: Record<string, unknown>,
  columns: string[],
  rows: Array<Array<string | number>>,
) => ({
  summary,
  query,
  columns,
  rows,
  truncated: false,
  tainted: false,
  outcome: "ok" as const,
  error: null,
  chart: null,
});

export const codeSearch =
  (code: CodeIndex): ToolFn =>
  async (raw) => {
    const args = CodeSearchArgs.safeParse(raw);
    if (!args.success) return invalid(args.error.issues.map((i) => i.message).join("; "));
    const hits = code.search(args.data.query, args.data.pathPrefix);
    return ok(
      `${hits.length} matches`,
      { ...args.data },
      ["path", "line", "text"],
      hits.map((h) => [h.path, h.line, h.text]),
    );
  };

export const codeRead =
  (code: CodeIndex): ToolFn =>
  async (raw) => {
    const args = CodeReadArgs.safeParse(raw);
    if (!args.success) return invalid(args.error.issues.map((i) => i.message).join("; "));
    if (args.data.endLine < args.data.startLine) return invalid("endLine must be ≥ startLine.");
    const lines = code.read(args.data.path, args.data.startLine, args.data.endLine);
    if (!lines) return invalid(`No file ${args.data.path} in the index.`);
    return ok(
      `${args.data.path}:${args.data.startLine}`,
      { ...args.data },
      ["line", "text"],
      lines.map((text, i) => [args.data.startLine + i, text]),
    );
  };
