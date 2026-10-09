import { alertPushPayload, type AlertRule } from "@mastertutor/contracts";
import { ATTR, SPAN, type PushOutcome } from "@mastertutor/contracts/telemetry";
import type { PushTarget } from "@mastertutor/db";
import { instrument } from "@mastertutor/telemetry/instrument";
import { recordPush } from "@mastertutor/telemetry/record";
import type { VapidKeys } from "../push/config.ts";
import { sendPush, type SendPush } from "../push/send.ts";

interface DeliverDeps {
  /** Null without VAPID keys or HTTPS: alerts stay in-app (spec §13.4). */
  vapid: VapidKeys | null;
  targets(): Promise<PushTarget[]>;
  forget(endpoint: string): Promise<void>;
  send?: SendPush;
}

/**
 * Fans one alert out to the owner's phones, in parallel, once each (spec §13.4, seam 10). Runs
 * after the webhook has answered, so it never rejects: a failed lookup sends nothing, a failed
 * forget is retried by the next 410.
 */
export async function deliverAlert(
  deps: DeliverDeps,
  alert: { id: string; rule: AlertRule },
): Promise<PushOutcome[]> {
  const vapid = deps.vapid;
  if (!vapid) return [];
  return instrument(SPAN.alertDelivery, { [ATTR.alertRule]: alert.rule }, async (span) => {
    const payload = alertPushPayload(alert);
    const send = deps.send ?? sendPush;
    const targets = await deps.targets().catch(() => {
      span.fail("push_targets_failed");
      return [];
    });
    const outcomes = await Promise.all(
      targets.map(async (target) => {
        const outcome = await send(target, payload, vapid);
        recordPush(outcome);
        if (outcome === "gone") await deps.forget(target.endpoint).catch(() => undefined);
        return outcome;
      }),
    );
    if (outcomes.length > 0 && !outcomes.includes("sent")) span.fail("push_failed");
    return outcomes;
  });
}
