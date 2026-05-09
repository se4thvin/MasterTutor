import { workspaceIdOf, type DbHandle } from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { liveOs } from "./live-os.ts";

/**
 * The one workspace check for live procedures (D4: one workspace in v1). After requireViewer it
 * resolves the viewer's workspace or answers FORBIDDEN; every handler then scopes by it. `actor`
 * is the viewer's id: audit rows, approvals' decidedBy and control requests use it.
 */
export const workspaceScoped = (db: () => DbHandle) =>
  liveOs.use(async ({ context, next }) => {
    const handle = db();
    const workspaceId = await workspaceIdOf(handle.db, context.viewer.id);
    if (workspaceId === null) throw new ORPCError("FORBIDDEN");
    return next({ context: { db: handle, workspaceId, actor: context.viewer.id } });
  });
