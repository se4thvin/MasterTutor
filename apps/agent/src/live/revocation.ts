import { decodeNotify } from "@mastertutor/contracts";
import { liveRevocationTargets, revokeLiveControl, type DbHandle } from "@mastertutor/db";
import type { Log } from "../runtime/types.ts";
import { NekoApiError, type NekoAdmin } from "./neko-admin.ts";

export interface LiveRevocationDeps {
  db: DbHandle;
  admin: NekoAdmin;
  log: Log;
}

/**
 * ForwardAuth checks a live view only when its websocket opens, so revocation must reach open
 * ones. Database triggers NOTIFY live_revoke when a person signs out (a session row is deleted)
 * or leaves a workspace; for each leased run they view or control, their control goes back to
 * the agent and the slot's n.eko user session is closed and deleted, so its token is dead too.
 * Returns the function that stops listening.
 */
export async function startLiveRevocation(deps: LiveRevocationDeps): Promise<() => Promise<void>> {
  const { db, admin, log } = deps;

  async function close(slotName: string, runId: string): Promise<void> {
    for (const [method, path] of [
      ["POST", "/api/sessions/user/disconnect"],
      ["DELETE", "/api/sessions/user"],
    ] as const) {
      await admin.request(slotName, method, path).catch((error: unknown) => {
        // Nobody connected, or already gone: nothing left open.
        if (error instanceof NekoApiError && error.status === 404) return;
        log.warn({ runId, errorCode: "live_revoke_failed" }, "could not close a live view");
      });
    }
  }

  async function revoke(payload: string): Promise<void> {
    const { userId, workspaceId } = decodeNotify("live_revoke", payload);
    for (const target of await liveRevocationTargets(db.db, { userId, workspaceId })) {
      await db.db.transaction((tx) => revokeLiveControl(tx, target.runId, userId));
      await close(target.slotName, target.runId);
    }
  }

  const { unlisten } = await db.sql.listen("live_revoke", (payload) => {
    void revoke(payload).catch((error: unknown) =>
      log.error(
        { errorCode: "live_revoke_failed", err: error instanceof Error ? error.name : "unknown" },
        "live revocation failed",
      ),
    );
  });
  return unlisten;
}
