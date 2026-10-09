import { COPILOT_LIMITS, OBSERVE_USERS, type ObserverEnv } from "@mastertutor/contracts";
import { createOpenAI } from "@mastertutor/contracts/server/openai";
import { createO2Client, DASHBOARD_FEW_SHOTS } from "@mastertutor/observability/query";
import { createAsk } from "./conversation.ts";
import { createO2Query } from "./o2.ts";
import { loadCodeIndex } from "./code-index.ts";
import { createToolRegistry } from "./tools/registry.ts";
import type { Logger } from "@mastertutor/contracts/server";
import { deleteThread, listThreads, loadResult, loadThread, type Database } from "@mastertutor/db";
import { HandleMap, copilotInstructions } from "@mastertutor/observer/copilot";
import type { ObserverRoutes } from "./server.ts";
import { resultView, threadView } from "./store.ts";

export async function createRoutes(deps: {
  env: ObserverEnv;
  db: Database;
  log: Logger;
}): Promise<ObserverRoutes> {
  const { env, db } = deps;
  const openai = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
    timeoutMs: 60_000,
  });
  const o2 = createO2Query(
    createO2Client({
      baseUrl: env.OBSERVE_URL,
      email: OBSERVE_USERS.copilot,
      password: env.OBSERVE_COPILOT_PASSWORD,
      timeoutMs: COPILOT_LIMITS.queryTimeoutMs,
    }),
  );
  const tools = createToolRegistry({ db, o2, code: await loadCodeIndex(env.OBSERVER_CODE_INDEX) });
  return {
    ask: createAsk({
      db,
      openai,
      tools,
      instructions: copilotInstructions(DASHBOARD_FEW_SHOTS),
      dailyUsd: env.OBSERVER_DAILY_USD,
      log: deps.log,
    }),
    async threads(caller) {
      return (await listThreads(db, caller.workspaceId)).map((t) => ({
        id: t.id,
        title: t.title.slice(0, 80),
        updatedAt: t.updatedAt.toISOString(),
      }));
    },
    thread: (caller, id) => threadView(db, caller.workspaceId, id, env.PUBLIC_URL),
    deleteThread: (caller, id) => deleteThread(db, caller.workspaceId, id),
    async result(caller, threadId, resultId) {
      const thread = await loadThread(db, caller.workspaceId, threadId);
      if (!thread) return null;
      const stored = await loadResult(db, threadId, resultId);
      return stored ? resultView(stored, new HandleMap(thread.handles), env.PUBLIC_URL) : null;
    },
  };
}
