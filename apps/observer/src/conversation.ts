import {
  COPILOT_LIMITS,
  CopilotAsk,
  type CopilotToolName,
  MODELS,
  untrustedText,
} from "@mastertutor/contracts";
import type { Logger } from "@mastertutor/contracts/server";
import {
  zodResponsesFunction,
  type ResponseOutputItem,
  type StatelessOpenAI,
} from "@mastertutor/contracts/server/openai";
import { ATTR, SPAN, SECRET_SCRUB_PATTERNS } from "@mastertutor/contracts/telemetry";
import {
  alertForCopilot,
  appendItems,
  countQuestionsSince,
  createThread,
  loadItems,
  loadResults,
  loadThread,
  runForCopilot,
  saveHandles,
  spentToday,
  type DbLike,
  type StoredResult,
} from "@mastertutor/db";
import { COPILOT_TOOLS, HandleMap, capCheck, checkCitations } from "@mastertutor/observer/copilot";
import { instrument } from "@mastertutor/telemetry/instrument";
import { recordObserverFailure } from "@mastertutor/telemetry/record";
import type { ObserverRoutes } from "./server.ts";
import { runToolRound } from "./tool-round.ts";
import { callModel } from "./model-call.ts";
import { serialTurn } from "./turn-queue.ts";
import { replayInput } from "./replay.ts";
import type { ToolFn } from "./tools/types.ts";

export interface ConversationDeps {
  db: DbLike;
  openai: Pick<StatelessOpenAI, "responses">;
  tools: Record<CopilotToolName, ToolFn>;
  /** Fixed catalog and examples, first in every stateless request. */
  instructions: string;
  dailyUsd: number;
  log: Logger;
}
const TOOL_DEFS = Object.entries(COPILOT_TOOLS).map(([name, tool]) =>
  zodResponsesFunction({ name, description: tool.description, parameters: tool.schema }),
);
const WINDOW_MS = COPILOT_LIMITS.windowMinutes * 60_000;
const redact = (text: string) =>
  SECRET_SCRUB_PATTERNS.reduce((out, pattern) => out.replace(pattern, "****"), text);

const messageText = (item: ResponseOutputItem): string =>
  item.type === "message"
    ? item.content.map((part) => (part.type === "output_text" ? part.text : "")).join("")
    : "";

export function createAsk(deps: ConversationDeps): ObserverRoutes["ask"] {
  const { db } = deps;
  const prefixChars = deps.instructions.length + JSON.stringify(TOOL_DEFS).length;
  return (caller, body, emit, signal) =>
    serialTurn(db, signal, () =>
      instrument(SPAN.observerTurn, { [ATTR.observerRole]: "copilot" }, async (span) => {
        const parsed = CopilotAsk.safeParse(body);
        if (!parsed.success) return emit({ type: "error", code: "internal" });
        const ask = parsed.data;
        const [questions, spent] = await Promise.all([
          countQuestionsSince(db, caller.workspaceId, new Date(Date.now() - WINDOW_MS)),
          spentToday(db),
        ]);
        const cap = capCheck({ questionsInWindow: questions, spentTodayUsd: spent }, deps.dailyUsd);
        if (!cap.ok) {
          span.set({ [ATTR.observerOutcome]: cap.code === "daily_cap" ? "capped" : "limit" });
          return emit({ type: "error", code: cap.code });
        }
        if (ask.context?.runId && !(await runForCopilot(db, caller.workspaceId, ask.context.runId)))
          return emit({ type: "error", code: "internal" });
        const thread = ask.threadId
          ? await loadThread(db, caller.workspaceId, ask.threadId)
          : {
              id: await createThread(db, {
                workspaceId: caller.workspaceId,
                createdBy: caller.userId,
                title: untrustedText(redact(ask.text), 80),
              }),
              handles: {},
            };
        if (!thread) return emit({ type: "error", code: "internal" });
        emit({ type: "thread", threadId: thread.id });
        const handles = new HandleMap(thread.handles);
        const tag = (item: Record<string, unknown>) => ({
          ...item,
          _copilotOptIn: ask.includeUntrusted,
        });
        let answer = "",
          turnUsd = 0;
        const results = new Map<string, StoredResult>(
          (await loadResults(db, thread.id)).map((r) => [r.resultId, r]),
        );
        const past = await loadItems(db, thread.id);
        let nextResult =
          Math.max(
            0,
            ...[...results.keys()].map((id) => Number(id.slice(1))),
            ...past.map(
              (entry) => Number(String(entry.item._copilotResultId ?? "Q0").slice(1)) || 0,
            ),
          ) + 1;
        try {
          // Recover a disconnected turn before appending a new question, preserving SDK call pairing.
          const pending = new Map<string, Record<string, unknown>>();
          for (const { item } of past) {
            if (item.type === "function_call" && typeof item.call_id === "string")
              pending.set(item.call_id, item);
            else if (item.type === "function_call_output" && typeof item.call_id === "string")
              pending.delete(item.call_id);
          }
          await appendItems(
            db,
            thread.id,
            [...pending].map(([callId, item]) => ({
              role: "tool",
              item: {
                type: "function_call_output",
                call_id: callId,
                output: "Previous turn interrupted; re-run if needed.",
                _copilotOptIn: item._copilotOptIn === true,
              },
            })),
          );
          let context = ask.context?.runId
            ? `Context: the user is looking at run ${handles.handleOf(ask.context.runId)}.\n`
            : "";
          if (ask.context?.alertId) {
            const alert = await alertForCopilot(db, caller.workspaceId, ask.context.alertId);
            if (alert)
              context += `Context: alert ${alert.rule} fired at ${alert.firedAt.toISOString()}.\n`;
          }
          await appendItems(db, thread.id, [
            {
              role: "user",
              item: tag({
                role: "user",
                content: `${context}${redact(handles.replaceUuids(ask.text))}`,
              }),
            },
          ]);
          for (let round = 0; round <= COPILOT_LIMITS.toolRounds; round++) {
            signal.throwIfAborted();
            if ((await spentToday(db)) >= deps.dailyUsd) {
              span.set({ [ATTR.observerOutcome]: "capped" });
              return emit({ type: "error", code: "daily_cap" });
            }
            const input = replayInput(
              await loadItems(db, thread.id),
              ask.includeUntrusted,
              prefixChars,
            );
            const response = await callModel(
              deps,
              {
                model: MODELS.observerCopilot,
                instructions: deps.instructions,
                input,
                tools: TOOL_DEFS,
                parallel_tool_calls: true,
                max_output_tokens: COPILOT_LIMITS.maxOutputTokens,
                include: ["reasoning.encrypted_content"],
                ...(round === COPILOT_LIMITS.toolRounds ? { tool_choice: "none" as const } : {}),
              },
              emit,
              signal,
            );
            if (!response) {
              span.set({ [ATTR.observerOutcome]: "capped" });
              return emit({ type: "error", code: "daily_cap" });
            }
            const { items, usd } = response;
            turnUsd += usd;
            const calls = items.filter((item) => item.type === "function_call");
            const stored = items.map((item) => {
              if (item.type !== "message") return item;
              const text = messageText(item);
              answer += text;
              const checked = checkCitations(text, new Set(results.keys()));
              return {
                ...item,
                content: [{ type: "output_text" as const, text: checked.text, annotations: [] }],
              };
            });
            await appendItems(
              db,
              thread.id,
              stored.map((item) => ({
                role: "assistant",
                item: tag(item as unknown as Record<string, unknown>),
              })),
            );
            if (calls.length === 0) break;
            const outputs = await runToolRound(
              { db, tools: deps.tools, threadId: thread.id },
              calls,
              { caller, handles, includeUntrusted: ask.includeUntrusted, results, signal },
              emit,
              round >= COPILOT_LIMITS.toolRounds,
              () => (nextResult <= 999 ? `Q${nextResult++}` : null),
            );
            await appendItems(db, thread.id, outputs);
            signal.throwIfAborted();
            if (round === COPILOT_LIMITS.toolRounds) {
              span.set({ [ATTR.observerOutcome]: "limit" });
              return emit({ type: "error", code: "internal" });
            }
          }
          const { citations, removed } = checkCitations(answer, new Set(results.keys()));
          span.set({ [ATTR.observerOutcome]: "ok" });
          emit({ type: "done", citations, removed, usd: Math.round(turnUsd * 1e6) / 1e6 });
        } catch {
          if (signal.aborted) return;
          recordObserverFailure("copilot", "error");
          deps.log.warn({ errorCode: "copilot_turn_failed" }, "copilot turn failed");
          emit({ type: "error", code: "model_unavailable" });
        } finally {
          await saveHandles(db, thread.id, handles.toJSON());
        }
      }),
    );
}
