import type { NotifyPayload } from "@mastertutor/contracts";
import {
  clearLiveViewer,
  liveViewsToClose,
  revokeLiveHolds,
  staleLiveHolds,
  type DbHandle,
} from "@mastertutor/db";
import { listenForAgentNotifications } from "../events/listen.ts";
import type { Log } from "../runtime/types.ts";
import { NekoApiError, type NekoAdmin } from "./neko-admin.ts";

export interface LiveRevocationDeps {
  db: DbHandle;
  admin: NekoAdmin;
  log: Log;
  /** First retry delay for a view that would not close; doubles each time, up to 30x. */
  retryBaseMs?: number;
}

type Revocation = NotifyPayload<"live_revoke">;

/**
 * ForwardAuth checks a live view only when its websocket opens, so revocation must reach open
 * ones. Database triggers NOTIFY live_revoke when a person signs out (a session row is deleted)
 * or leaves a workspace: wherever they hold control it goes back to the agent, and each live view
 * they have open has its n.eko user session closed and deleted, so its token is dead too.
 * Any deleted session row counts as a sign-out, so signing out on one device (or Better Auth
 * pruning an old session) also closes the views open on the person's others. That over-revokes
 * on purpose: failing safe costs them one reopen, which a fresh ForwardAuth check then allows.
 *
 * A notification sent while the agent was down or its LISTEN reconnecting is lost, so every
 * (re)established LISTEN, the first one included, sweeps for people who view or control a run
 * but signed out (or whose session expired) or left its workspace. A view that would not close
 * stays recorded and is retried with backoff until it closes or its lease ends.
 * Returns the function that stops listening.
 */
export async function startLiveRevocation(deps: LiveRevocationDeps): Promise<() => Promise<void>> {
  const { db, admin, log } = deps;
  const retryBaseMs = deps.retryBaseMs ?? 1_000;
  const running = new Map<string, { again: boolean; done: Promise<void> }>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;

  async function closeView(slotName: string): Promise<void> {
    for (const [method, path] of [
      ["POST", "/api/sessions/user/disconnect"],
      ["DELETE", "/api/sessions/user"],
    ] as const) {
      await admin.request(slotName, method, path).catch((error: unknown) => {
        // Nobody connected, or already gone: nothing left open.
        if (!(error instanceof NekoApiError && error.status === 404)) throw error;
      });
    }
  }

  /** True once nothing of theirs is left open. Views are re-read each attempt (lease may end). */
  async function revoke(target: Revocation): Promise<boolean> {
    await db.db.transaction((tx) => revokeLiveHolds(tx, target));
    let closedAll = true;
    for (const view of await liveViewsToClose(db.db, target)) {
      try {
        await closeView(view.slotName);
        await clearLiveViewer(db.db, view.runId, target.userId);
      } catch {
        closedAll = false;
        log.warn(
          { runId: view.runId, errorCode: "live_revoke_failed" },
          "could not close a live view",
        );
      }
    }
    return closedAll;
  }

  function schedule(target: Revocation, attempt = 0): void {
    if (stopped) return;
    const key = `${target.userId}/${target.workspaceId ?? "*"}`;
    const inFlight = running.get(key);
    if (inFlight) {
      inFlight.again = true; // a newer notice: run once more after this pass, from scratch
      return;
    }
    clearTimeout(retries.get(key));
    retries.delete(key);
    const pass = {
      again: false,
      done: revoke(target)
        .catch((error: unknown) => {
          log.error(
            {
              errorCode: "live_revoke_failed",
              err: error instanceof Error ? error.name : "unknown",
            },
            "live revocation failed",
          );
          return false;
        })
        .then((closedAll) => {
          running.delete(key);
          if (pass.again) return schedule(target);
          if (closedAll || stopped) return;
          const delay = Math.min(retryBaseMs * 2 ** attempt, retryBaseMs * 30);
          retries.set(
            key,
            setTimeout(() => schedule(target, attempt + 1), delay),
          );
        }),
    };
    running.set(key, pass);
  }

  function sweep(): void {
    void staleLiveHolds(db.db)
      .then((holds) => holds.forEach((hold) => schedule(hold)))
      .catch((error: unknown) =>
        log.error(
          { errorCode: "live_revoke_failed", err: error instanceof Error ? error.name : "unknown" },
          "live revocation sweep failed",
        ),
      );
  }

  const unlisten = await listenForAgentNotifications(
    db.sql,
    { live_revoke: (target) => schedule(target) },
    log,
    sweep,
  );
  return async () => {
    stopped = true;
    retries.forEach((timer) => clearTimeout(timer));
    await unlisten();
    await Promise.all([...running.values()].map((pass) => pass.done));
  };
}
