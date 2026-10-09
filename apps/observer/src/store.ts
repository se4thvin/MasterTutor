import { RETENTION_DAYS } from "@mastertutor/contracts/telemetry";
import type { CopilotResultView, CopilotThreadView } from "@mastertutor/contracts";
import {
  loadItems,
  loadResults,
  loadThread,
  type DbLike,
  type StoredResult,
} from "@mastertutor/db";
import { HandleMap, checkCitations, o2TraceLink, runLink } from "@mastertutor/observer/copilot";

/** A stored result as the UI sees it: links resolved from handles on the server (spec §7.5). */
export function resultView(
  stored: StoredResult,
  handles: HandleMap,
  appUrl: string,
): CopilotResultView {
  const runColumn = stored.columns.indexOf("run");
  const singleRun = stored.rows.length === 1 && runColumn >= 0 ? stored.rows[0]?.[runColumn] : null;
  const handle =
    typeof stored.query.run === "string"
      ? stored.query.run
      : typeof singleRun === "string"
        ? singleRun
        : null;
  const runId = handle ? handles.runIdOf(handle) : null;
  const now = Date.now() * 1_000;
  return {
    resultId: stored.resultId,
    tool: stored.tool,
    summary: stored.summary.slice(0, 200),
    columns: stored.columns,
    rows: stored.rows.map((row) =>
      row.map((cell) => (typeof cell === "string" ? handles.replaceUuids(cell) : cell)),
    ),
    rowCount: stored.rowCount,
    truncated: stored.truncated,
    tookMs: stored.tookMs,
    links: {
      app: runId ? runLink(runId) : null,
      o2: runId
        ? o2TraceLink(appUrl, runId, {
            fromUs: now - RETENTION_DAYS.traces * 86_400_000_000,
            toUs: now,
          })
        : null,
    },
    tainted: stored.tainted,
  };
}

const textOf = (item: Record<string, unknown>): string => {
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return (item.content as Array<{ type?: string; text?: string }>)
    .filter((part) => part.type === "output_text" || part.type === "input_text")
    .map((part) => part.text ?? "")
    .join("");
};

export async function threadView(
  db: DbLike,
  workspaceId: string,
  id: string,
  appUrl: string,
): Promise<CopilotThreadView | null> {
  const thread = await loadThread(db, workspaceId, id);
  if (!thread) return null;
  const [items, results] = await Promise.all([loadItems(db, id), loadResults(db, id)]);
  const handles = new HandleMap(thread.handles);
  const known = new Set(results.map((result) => result.resultId));
  return {
    id: thread.id,
    title: thread.title.slice(0, 80),
    messages: items
      .filter(
        (entry) =>
          entry.role === "user" || (entry.role === "assistant" && entry.item.role === "assistant"),
      )
      .map((entry) => {
        const raw = textOf(entry.item);
        const checked = checkCitations(raw, known);
        const text = entry.role === "user" ? raw : checked.text;
        return {
          role: entry.role === "user" ? "user" : "assistant",
          text,
          citations: entry.role === "user" ? [] : checked.citations,
        } as const;
      }),
    results: results.map((stored) => resultView(stored, handles, appUrl)),
  };
}
