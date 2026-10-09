import type { ObserverEnv } from "@mastertutor/contracts";
import type { Logger } from "@mastertutor/contracts/server";
import { deleteThread, listThreads, loadResult, loadThread, type Database } from "@mastertutor/db";
import { HandleMap } from "@mastertutor/observer/copilot";
import type { ObserverRoutes } from "./server.ts";
import { resultView, threadView } from "./store.ts";

export async function createRoutes(deps: {
  env: ObserverEnv;
  db: Database;
  log: Logger;
}): Promise<ObserverRoutes> {
  const { env, db } = deps;
  return {
    async ask(_caller, _body, emit) {
      emit({ type: "error", code: "internal" });
    },
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
