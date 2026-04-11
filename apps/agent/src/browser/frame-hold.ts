import type { CDPSession } from "playwright-core";

/** The script every held frame gets before its first document runs, and how to disarm it. */
export interface HeldFrameGuard {
  source: string;
  worldName: string;
  /** An expression evaluated in `worldName`: true when the guard there cancelled input. */
  disarmExpression: string;
  /** How long release() waits for a held frame to answer before letting go anyway. */
  budgetMs: number;
}

export interface FrameHold {
  /**
   * Stops holding new frames, disarms the guard in each frame it held and detaches from every
   * frame it attached to, so none stays paused. Resolves true when a held frame's guard cancelled
   * input. Never throws.
   */
  release(): Promise<boolean>;
}

type AttachedEvent = {
  sessionId: string;
  targetInfo: { targetId: string; type: string };
  waitingForDebugger: boolean;
};
type Reply = { id?: number; result?: unknown; error?: unknown };

/**
 * While a click is armed, a frame that starts in a new process (a frame added on another site, or
 * an existing frame navigated to one) runs in a target the page's new-document script never
 * reaches. Auto-attach on `cdp` holds each such frame before its first document runs, calls
 * `onNew`, installs the guard script there, then lets it go. A frame target already running that
 * is not one of the `known` (armed) out-of-process frames is treated the same, without the hold.
 * Messages to those frames go through
 * `cdp` (non-flat), as Playwright's CDP sessions cannot address flat child sessions.
 */
export async function holdNewProcessFrames(
  cdp: CDPSession,
  guard: HeldFrameGuard,
  known: Promise<ReadonlySet<string>>,
  onNew: () => void,
): Promise<FrameHold> {
  let next = 0;
  const pending = new Map<number, (reply: Reply) => void>();
  const onMessage = (event: { message: string }) => {
    const reply = JSON.parse(event.message) as Reply;
    if (reply.id === undefined) return;
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  };
  const call = <R>(sessionId: string, method: string, params: object = {}) =>
    new Promise<R>((resolve, reject) => {
      const id = ++next;
      pending.set(id, (reply) =>
        reply.error === undefined ? resolve(reply.result as R) : reject(new Error(method)),
      );
      cdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch((error: unknown) => {
          pending.delete(id);
          reject(error);
        });
    });

  const attached: Array<{ sessionId: string; frameId: string; ready: Promise<void> | null }> = [];
  const install = async (sessionId: string) => {
    await call(sessionId, "Page.enable");
    await call(sessionId, "Page.addScriptToEvaluateOnNewDocument", {
      source: guard.source,
      worldName: guard.worldName,
    });
  };
  const onAttached = (event: AttachedEvent) => {
    const { sessionId, targetInfo, waitingForDebugger } = event;
    const frameId = targetInfo.targetId;
    let ready: Promise<void> | null = null;
    let installed: Promise<boolean> = Promise.resolve(true);
    if (targetInfo.type === "iframe" && waitingForDebugger) {
      onNew();
      installed = install(sessionId).then(
        () => true,
        () => false,
      );
      ready = installed.then(() => undefined);
    } else if (targetInfo.type === "iframe") {
      // Already running when the hold began, yet not a frame the guard armed: a navigation to
      // another site that was under way (its document may not have committed yet).
      ready = known
        .then(async (armed) => {
          if (armed.has(frameId)) return;
          onNew();
          await install(sessionId);
        })
        .catch(() => undefined);
    }
    attached.push({ sessionId, frameId, ready });
    // A held frame goes on once it has the guard. If installing failed it stays held until
    // release() detaches (which lets it run): never unguarded while the click is armed.
    if (waitingForDebugger)
      void installed.then((ok) =>
        ok ? call(sessionId, "Runtime.runIfWaitingForDebugger").catch(() => undefined) : undefined,
      );
  };
  cdp.on("Target.receivedMessageFromTarget", onMessage);
  cdp.on("Target.attachedToTarget", onAttached);
  const stop = () =>
    cdp
      .send("Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: false,
      })
      .catch(() => undefined);
  try {
    await cdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
    });
  } catch (error) {
    await stop();
    cdp.off("Target.attachedToTarget", onAttached);
    cdp.off("Target.receivedMessageFromTarget", onMessage);
    throw error;
  }

  const disarmHeld = async ({
    sessionId,
    frameId,
    ready,
  }: {
    sessionId: string;
    frameId: string;
    ready: Promise<void>;
  }) => {
    await ready;
    const { executionContextId } = await call<{ executionContextId: number }>(
      sessionId,
      "Page.createIsolatedWorld",
      { frameId, worldName: guard.worldName },
    );
    const { result } = await call<{ result: { value?: unknown } }>(sessionId, "Runtime.evaluate", {
      expression: guard.disarmExpression,
      contextId: executionContextId,
      returnByValue: true,
    });
    return result.value === true;
  };

  let released: Promise<boolean> | null = null;
  return {
    release: () =>
      (released ??= (async () => {
        await stop();
        cdp.off("Target.attachedToTarget", onAttached);
        const held = attached.flatMap(({ sessionId, frameId, ready }) =>
          ready ? [disarmHeld({ sessionId, frameId, ready }).catch(() => false)] : [],
        );
        const cancelled = await Promise.race([
          Promise.all(held),
          new Promise<boolean[]>((resolve) =>
            setTimeout(() => resolve([false]), guard.budgetMs).unref(),
          ),
        ]);
        // Detaching lets any frame still held run.
        await Promise.all(
          attached.map(({ sessionId }) =>
            cdp.send("Target.detachFromTarget", { sessionId }).catch(() => undefined),
          ),
        );
        cdp.off("Target.receivedMessageFromTarget", onMessage);
        for (const settle of pending.values()) settle({ error: "released" });
        pending.clear();
        return cancelled.includes(true);
      })()),
  };
}
