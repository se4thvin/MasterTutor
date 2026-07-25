import { decodeNotify, type NotifyChannel, type NotifyPayload } from "@mastertutor/contracts";
import type { Sql } from "postgres";
import type { Log } from "../runtime/types.ts";

export type AgentChannel = Exclude<NotifyChannel, "run_event">;
export type NotificationHandlers = {
  [C in AgentChannel]?: (payload: NotifyPayload<C>) => void;
};

/**
 * LISTENs on the web → agent channels (spec §3.1 rule 2). Payloads carry ids only. `onListen`
 * runs each time a channel's LISTEN is (re)established, at start and after every reconnect, so a
 * caller can reconcile whatever was notified while it was not listening.
 */
export async function listenForAgentNotifications(
  sql: Sql,
  handlers: NotificationHandlers,
  log: Log,
  onListen?: () => void,
): Promise<() => Promise<void>> {
  const subscriptions: Array<{ unlisten(): Promise<void> }> = [];
  for (const channel of Object.keys(handlers) as AgentChannel[]) {
    const handler = handlers[channel] as ((payload: unknown) => void) | undefined;
    if (!handler) continue;
    const subscription = await sql.listen(
      channel,
      (text) => {
        let payload: unknown;
        try {
          payload = decodeNotify(channel, text);
        } catch {
          log.warn({ channel }, "ignored a malformed notification");
          return;
        }
        handler(payload);
      },
      onListen,
    );
    subscriptions.push(subscription);
  }
  return async () => {
    await Promise.all(subscriptions.map((subscription) => subscription.unlisten()));
  };
}
