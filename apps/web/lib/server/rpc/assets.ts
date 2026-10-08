import type { DbHandle } from "@mastertutor/db";
import { assetUrl } from "../library/objects.ts";
import { served } from "../service-error.ts";
import { workspaceScoped } from "./workspace-scope.ts";

/** assets.* for the live router. */
export function createAssetProcedures(deps: { db(): DbHandle }) {
  const scoped = workspaceScoped(deps.db);
  return {
    url: scoped.assets.url.handler(({ context, input }) =>
      served(() => assetUrl(context.db.db, context.workspaceId, input)),
    ),
  };
}
