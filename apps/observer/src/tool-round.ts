import {
  COPILOT_LIMITS,
  CopilotToolName,
  untrustedText,
  wrapUntrusted,
  type CopilotEvent,
} from "@mastertutor/contracts";
import { ATTR, SPAN, SECRET_SCRUB_PATTERNS } from "@mastertutor/contracts/telemetry";
import type { ResponseOutputItem } from "@mastertutor/contracts/server/openai";
import { saveResult, type DbLike, type StoredResult } from "@mastertutor/db";
import type { HandleMap } from "@mastertutor/observer/copilot";
import { instrument } from "@mastertutor/telemetry/instrument";
import { invalid, type ToolFn, type ToolRun, type ToolContext } from "./tools/types.ts";

const redact = (text: string) =>
  SECRET_SCRUB_PATTERNS.reduce((out, pattern) => out.replace(pattern, "****"), text);
const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

function toolOutput(resultId: string, run: ToolRun, handles: HandleMap): string {
  if (run.outcome !== "ok") return JSON.stringify({ resultId, error: run.error ?? run.outcome });
  const clean = (text: string) => redact(handles.replaceUuids(text));
  const rows = run.rows
    .slice(0, COPILOT_LIMITS.modelRows)
    .map((row) =>
      row.map((cell) =>
        typeof cell === "string" ? clean(run.tainted ? untrustedText(cell) : cell) : cell,
      ),
    );
  // Scrub scalar values before serialization: a cookie pattern must never consume JSON framing.
  const body = JSON.stringify({
    resultId,
    summary: clean(run.summary),
    columns: run.columns.map(clean),
    rows,
    rowCount: run.rows.length,
    truncated: run.truncated || run.rows.length > rows.length,
  });
  return run.tainted ? wrapUntrusted("telemetry", body) : body;
}

/** Execute only four calls; every SDK call still gets a paired bounded output. */
export async function runToolRound(
  deps: { db: DbLike; tools: Record<CopilotToolName, ToolFn>; threadId: string },
  calls: Array<Extract<ResponseOutputItem, { type: "function_call" }>>,
  ctx: ToolContext & { results: Map<string, StoredResult> },
  emit: (event: CopilotEvent) => void,
  finalRound: boolean,
  nextResultId: () => string | null,
) {
  const { db, tools, threadId } = deps;
  const { caller, handles, includeUntrusted, results, signal } = ctx;
  const tag = (item: Record<string, unknown>) => ({ ...item, _copilotOptIn: includeUntrusted });
  return Promise.all(
    calls.map(async (call, index) => {
      const output = (text: string, resultId?: string) => ({
        role: "tool" as const,
        item: tag({
          type: "function_call_output",
          call_id: call.call_id,
          output: text,
          ...(resultId ? { _copilotResultId: resultId } : {}),
        }),
      });
      if (index >= COPILOT_LIMITS.parallelCalls || finalRound)
        return output("Tool-call limit reached; ask a narrower question.");
      const resultId = nextResultId();
      if (!resultId) return output("Result limit reached; start a new thread.");
      const known = CopilotToolName.safeParse(call.name);
      if (!known.success)
        return output(
          JSON.stringify({ resultId, error: "Unknown tool; use a listed function." }),
          resultId,
        );
      const name = known.data;
      emit({ type: "tool_started", resultId, tool: name, summary: name });
      const started = performance.now();
      let run: ToolRun;
      try {
        run = await instrument(
          SPAN.observerTool,
          { [ATTR.observerTool]: name },
          async (toolSpan) => {
            const ran = await tools[name](safeJson(call.arguments), {
              caller,
              handles,
              includeUntrusted: includeUntrusted,
              results,
              signal,
            });
            toolSpan.set({
              [ATTR.observerOutcome]:
                ran.outcome === "ok" ? "ok" : ran.outcome === "invalid" ? "invalid" : "error",
            });
            return ran;
          },
        );
        if (run.outcome === "ok" && !signal.aborted) {
          const result: StoredResult = {
            resultId,
            tool: name,
            summary: run.summary,
            query: run.query,
            columns: run.columns,
            rows: run.rows,
            rowCount: run.rows.length,
            truncated: run.truncated,
            tookMs: Math.round(performance.now() - started),
            tainted: run.tainted,
          };
          await saveResult(db, threadId, result);
          results.set(resultId, result);
        }
      } catch {
        run = { ...invalid("Read failed; retry a bounded query."), outcome: "error" };
      }
      if (!signal.aborted) {
        emit({
          type: "tool_done",
          resultId,
          rowCount: run.rows.length,
          tookMs: Math.round(performance.now() - started),
          outcome: run.outcome,
        });
        if (run.chart) emit({ type: "chart", spec: run.chart });
      }
      return output(toolOutput(resultId, run, handles), resultId);
    }),
  );
}
