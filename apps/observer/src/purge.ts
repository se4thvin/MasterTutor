import { COPILOT_LIMITS } from "@mastertutor/contracts";
import type { Logger } from "@mastertutor/contracts/server";
import { purgeThreadsBefore, type DbLike } from "@mastertutor/db";

const DAY_MS = 86_400_000;

/** 30-day retention, like logs (spec §7.8): at start and every 24 h. */
export function startPurge(db: DbLike, log: Logger): () => void {
  const run = () =>
    void purgeThreadsBefore(db, new Date(Date.now() - COPILOT_LIMITS.retentionDays * DAY_MS)).catch(
      (error: unknown) =>
        log.warn(
          {
            errorCode: "copilot_purge_failed",
            errName: error instanceof Error ? error.name : "unknown",
          },
          "purge failed",
        ),
    );
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
