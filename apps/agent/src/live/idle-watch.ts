import type { Log } from "../runtime/types.ts";
import type { SlotIdleProbe } from "./idle-probe.ts";

export interface IdleWatchDeps {
  probe: SlotIdleProbe;
  limitMs: number;
  pollMs: number;
  /** Returns control to the agent; a throw is retried on the next poll. */
  onIdle(runId: string): Promise<void>;
  log: Log;
  now?: () => number;
}

export interface IdleWatch {
  arm(slotName: string, runId: string): void;
  disarm(runId: string): void;
}

/**
 * Spec §5.1: a takeover ends after limitMs with no user input. The slot's X idle time counts
 * only the user's input (n.eko injects it through XTest; CDP never touches X), and it is capped
 * by the time since the takeover, so the minutes before the user took over never count.
 */
export function createIdleWatch(deps: IdleWatchDeps): IdleWatch {
  const now = deps.now ?? (() => performance.now());
  const timers = new Map<string, NodeJS.Timeout>();
  const disarm = (runId: string) => {
    clearInterval(timers.get(runId));
    timers.delete(runId);
  };
  return {
    arm(slotName, runId) {
      disarm(runId);
      const since = now();
      let checking = false;
      const timer: NodeJS.Timeout = setInterval(() => {
        if (checking) return;
        checking = true;
        deps.probe
          .userIdleMs(slotName)
          .then(async (idleMs) => {
            if (timers.get(runId) !== timer) return;
            if (Math.min(idleMs, now() - since) < deps.limitMs) return;
            await deps.onIdle(runId);
            if (timers.get(runId) === timer) disarm(runId);
          })
          .catch(() =>
            deps.log.warn({ runId, errorCode: "idle_hand_back_retry" }, "idle check failed"),
          )
          .finally(() => {
            checking = false;
          });
      }, deps.pollMs);
      timer.unref();
      timers.set(runId, timer);
    },
    disarm,
  };
}
