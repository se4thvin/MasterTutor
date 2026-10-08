import type { CDPSession } from "playwright-core";

/** A CDP connection: a Playwright session, or a frame target reached through one (non-flat). */
export interface CdpChannel {
  send<R = unknown>(method: string, params?: object): Promise<R>;
  on(method: string, listener: (params: never) => void): void;
}

/** What the watcher reports for each frame target, in the order it happens. */
export interface FrameTargetEvents {
  /**
   * A frame target `targetId` (an out-of-process frame, CDP frame id) appeared under `parent` (the
   * out-of-process frame it lies in; null: the page's own process). `channel` reaches it; it is
   * paused (when `waiting`) until this resolves, so it cannot navigate unobserved. `late`: it was
   * already running when it was found.
   */
  attached(channel: CdpChannel, targetId: string, parent: string | null, late: boolean): void;
  /** The target is gone (its channel no longer speaks). */
  detached(targetId: string): void;
}

type AttachedEvent = {
  sessionId: string;
  targetInfo: { targetId: string; type: string };
  waitingForDebugger: boolean;
};
type Reply = { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: false };

/** The Playwright session as a channel. */
export function sessionChannel(cdp: CDPSession): CdpChannel {
  const send = cdp.send.bind(cdp) as unknown as (method: string, params?: object) => Promise<never>;
  const on = cdp.on.bind(cdp) as unknown as (method: string, listener: (p: never) => void) => void;
  return { send: (method, params) => send(method, params), on };
}

/** A target attached through `parent` (non-flat: messages wrapped in Target.sendMessageToTarget). */
function childChannel(parent: CdpChannel, sessionId: string) {
  let next = 0;
  const pending = new Map<number, (reply: Reply) => void>();
  const listeners = new Map<string, Array<(params: never) => void>>();
  const channel: CdpChannel & { receive(message: string): void; close(): void } = {
    send: <R>(method: string, params: object = {}) =>
      new Promise<R>((resolve, reject) => {
        const id = ++next;
        pending.set(id, (reply) =>
          reply.error === undefined
            ? resolve(reply.result as R)
            : reject(new Error(`${method}: ${JSON.stringify(reply.error)}`)),
        );
        parent
          .send("Target.sendMessageToTarget", {
            sessionId,
            message: JSON.stringify({ id, method, params }),
          })
          .catch((error: unknown) => {
            pending.delete(id);
            reject(error instanceof Error ? error : new Error(method));
          });
      }),
    on: (method, listener) => listeners.set(method, [...(listeners.get(method) ?? []), listener]),
    receive: (message) => {
      const reply = JSON.parse(message) as Reply;
      if (reply.id !== undefined) {
        pending.get(reply.id)?.(reply);
        pending.delete(reply.id);
      } else if (reply.method)
        for (const listener of listeners.get(reply.method) ?? []) listener(reply.params as never);
    },
    close: () => {
      for (const settle of pending.values()) settle({ error: "detached" });
      pending.clear();
    },
  };
  return channel;
}

/**
 * Follows every frame target under `root` (the page's session) for the page's lifetime: each new
 * one is held before its first document runs (auto-attach, waitForDebuggerOnStart), reported to
 * `events` (which arms its observers), then resumed; its own frame targets are followed the same
 * way. A target that cannot be followed stays held. Other targets (workers) are resumed and left
 * alone. Throws when `root` itself cannot be followed.
 */
export async function watchFrameTargets(
  root: CdpChannel,
  events: FrameTargetEvents,
): Promise<void> {
  // Each followed target, by its parent channel's session id: its id, its channel, and how to
  // report everything under it gone (a target's own detach events die with its parent's channel).
  type Followed = { targetId: string; channel: ReturnType<typeof childChannel>; gone(): void };
  const follow = async (channel: CdpChannel, parent: string | null): Promise<() => void> => {
    const children = new Map<string, Followed>();
    const gone = (sessionId: string) => {
      const child = children.get(sessionId);
      if (!child) return;
      children.delete(sessionId);
      child.channel.close();
      child.gone();
      events.detached(child.targetId);
    };
    channel.on("Target.receivedMessageFromTarget", ((event: {
      sessionId: string;
      message: string;
    }) => children.get(event.sessionId)?.channel.receive(event.message)) as (
      params: never,
    ) => void);
    channel.on("Target.detachedFromTarget", ((event: { sessionId: string }) =>
      gone(event.sessionId)) as (params: never) => void);
    channel.on("Target.attachedToTarget", ((event: AttachedEvent) => {
      const { sessionId, targetInfo, waitingForDebugger } = event;
      const child = childChannel(channel, sessionId);
      const resume = () =>
        waitingForDebugger
          ? child.send("Runtime.runIfWaitingForDebugger").catch(() => undefined)
          : undefined;
      if (targetInfo.type !== "iframe") {
        void Promise.resolve(resume()).then(() =>
          channel.send("Target.detachFromTarget", { sessionId }).catch(() => undefined),
        );
        return;
      }
      const followed: Followed = { targetId: targetInfo.targetId, channel: child, gone: () => {} };
      children.set(sessionId, followed);
      events.attached(child, targetInfo.targetId, parent, !waitingForDebugger);
      void (async () => {
        try {
          await child.send("Page.enable");
          followed.gone = await follow(child, targetInfo.targetId);
        } catch {
          // Not observed, so not resumed: held, it cannot navigate unseen (fail closed).
          return;
        }
        await resume();
      })();
    }) as (params: never) => void);
    await channel.send("Target.setAutoAttach", AUTO_ATTACH);
    return () => {
      for (const sessionId of [...children.keys()]) gone(sessionId);
    };
  };
  await follow(root, null);
}
