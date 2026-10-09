import { ALERT_DEDUPE_MINUTES, internalWebHosts } from "@mastertutor/contracts";
import {
  deletePushSubscriptionByEndpoint,
  onlyWorkspaceId,
  ownerPushTargets,
  recordAlert,
} from "@mastertutor/db";
import { after } from "next/server";
import { deliverAlert } from "@/lib/server/alerts/deliver.ts";
import { handleAlertWebhook } from "@/lib/server/alerts/webhook.ts";
import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { vapidKeysOf } from "@/lib/server/push/config.ts";

export const dynamic = "force-dynamic";

/** OpenObserve's alert destination, over the internal `observe` network (spec §13.2). */
export async function POST(request: Request): Promise<Response> {
  const env = getWebEnv();
  // A fixture build has no OpenObserve; the webhook does not exist there.
  if (__FIXTURE_BUILD__ && env.WEB_FIXTURE_API)
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return handleAlertWebhook(
    {
      secret: env.ALERT_WEBHOOK_SECRET,
      internalHosts: internalWebHosts(env.CDP_SUBNET_PREFIX),
      record: async (rule) => {
        const db = getDb().db;
        const workspaceId = await onlyWorkspaceId(db);
        if (!workspaceId) return null;
        const alert = await recordAlert(db, {
          workspaceId,
          rule,
          dedupeMinutes: ALERT_DEDUPE_MINUTES,
        });
        return { ...alert, workspaceId };
      },
      onRecorded: (alert) =>
        after(async () => {
          const db = getDb().db;
          await deliverAlert(
            {
              vapid: vapidKeysOf(env),
              targets: () => ownerPushTargets(db, alert.workspaceId),
              forget: (endpoint) => deletePushSubscriptionByEndpoint(db, endpoint),
            },
            alert,
          );
        }),
    },
    request,
  );
}
