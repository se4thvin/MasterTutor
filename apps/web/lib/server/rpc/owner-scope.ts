import { memberRoleOf, type DbHandle } from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { liveOs } from "./live-os.ts";

/**
 * Owner-only procedures (D50: alerts and push). Like workspaceScoped, but the viewer must hold the
 * owner role; anyone else is FORBIDDEN and learns nothing.
 */
export const ownerScoped = (db: () => DbHandle) =>
  liveOs.use(async ({ context, next }) => {
    const handle = db();
    const membership = await memberRoleOf(handle.db, context.viewer.id);
    if (membership?.role !== "owner") throw new ORPCError("FORBIDDEN");
    return next({
      context: { db: handle, workspaceId: membership.workspaceId, actor: context.viewer.id },
    });
  });
