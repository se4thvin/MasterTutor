import { ORPCError, os } from "@orpc/server";
import type { Viewer } from "../viewer.ts";

/** What every RPC router receives from the route: the session's viewer, or null when signed out. */
export interface SessionContext {
  viewer: Viewer | null;
}

/**
 * Every procedure requires a viewer. A missing or expired session is a typed UNAUTHORIZED oRPC
 * error, which the client turns into a return to sign-in (a bare 401 JSON body would not be).
 */
export const requireViewer = os.$context<SessionContext>().middleware(async ({ context, next }) => {
  if (!context.viewer) throw new ORPCError("UNAUTHORIZED");
  return next({ context: { viewer: context.viewer } });
});
