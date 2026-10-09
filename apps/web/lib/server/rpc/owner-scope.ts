import { PersonDecider } from "@mastertutor/contracts";
import { memberRoleOf, type DbHandle } from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { liveOs } from "./live-os.ts";

/**
 * Owner-only procedures (D50: alerts and push). Like workspaceScoped, but the viewer must hold the
 * owner role; anyone else is FORBIDDEN and learns nothing.
 */
export const ownerScoped = (db: () => DbHandle) =>
  liveOs.use(async ({ context, next }) => {
    const actor = PersonDecider.safeParse(context.viewer.id);
    if (!actor.success) throw new ORPCError("FORBIDDEN");
    const handle = db();
    const membership = await memberRoleOf(handle.db, actor.data);
    if (membership?.role !== "owner") throw new ORPCError("FORBIDDEN");
    return next({
      context: { db: handle, workspaceId: membership.workspaceId, actor: actor.data },
    });
  });
