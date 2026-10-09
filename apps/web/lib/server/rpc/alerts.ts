import type { PushConfig } from "@mastertutor/contracts";
import {
  KeysetCursorInvalid,
  acknowledgeAlert,
  activeAlerts,
  deletePushSubscription,
  isPushSubscribed,
  listAlerts,
  savePushSubscription,
  type DbHandle,
} from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { ownerScoped } from "./owner-scope.ts";

/** alerts.* (spec §13.3, §13.4): the workspace owner only. */
export function createAlertProcedures(deps: { db(): DbHandle; push(): PushConfig }) {
  const owner = ownerScoped(deps.db);
  return {
    list: owner.alerts.list.handler(async ({ context, input }) => {
      try {
        return await listAlerts(context.db.db, context.workspaceId, input);
      } catch (error) {
        if (error instanceof KeysetCursorInvalid)
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        throw error;
      }
    }),
    active: owner.alerts.active.handler(async ({ context }) => ({
      items: await activeAlerts(context.db.db, context.workspaceId),
    })),
    acknowledge: owner.alerts.acknowledge.handler(async ({ context, input }) => {
      const found = await acknowledgeAlert(context.db.db, {
        workspaceId: context.workspaceId,
        alertId: input.id,
        userId: context.actor,
      });
      if (!found) throw new ORPCError("NOT_FOUND", { message: "Alert not found" });
      return { ok: true as const };
    }),
    pushConfig: owner.alerts.pushConfig.handler(() => deps.push()),
    subscribe: owner.alerts.subscribe.handler(async ({ context, input }) => {
      if (!deps.push().available)
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Phone alerts aren't set up on this server.",
        });
      await savePushSubscription(context.db.db, {
        userId: context.actor,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      });
      return { ok: true as const };
    }),
    pushStatus: owner.alerts.pushStatus.handler(async ({ context, input }) => ({
      registered: await isPushSubscribed(context.db.db, {
        userId: context.actor,
        endpoint: input.endpoint,
      }),
    })),
    unsubscribe: owner.alerts.unsubscribe.handler(async ({ context, input }) => {
      await deletePushSubscription(context.db.db, {
        userId: context.actor,
        endpoint: input.endpoint,
      });
      return { ok: true as const };
    }),
  };
}
