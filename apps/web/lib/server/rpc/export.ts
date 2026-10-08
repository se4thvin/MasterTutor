import type { DbHandle } from "@mastertutor/db";
import { exportNote } from "../library/export.ts";
import { served } from "../service-error.ts";
import { workspaceScoped } from "./workspace-scope.ts";

/** notes.export for the live router: the download path of the note's zip. */
export function createExportProcedure(deps: { db(): DbHandle }) {
  return workspaceScoped(deps.db).notes.export.handler(({ context, input }) =>
    served(() => exportNote(context.db.db, context.workspaceId, input)),
  );
}
