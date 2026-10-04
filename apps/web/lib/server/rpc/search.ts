import type { EmbeddingsClient } from "@mastertutor/contracts/server";
import type { DbHandle } from "@mastertutor/db";
import { searchNotes } from "../library/search.ts";
import { served } from "../service-error.ts";
import { workspaceScoped } from "./workspace-scope.ts";

/** notes.search for the live router: hybrid search in the viewer's workspace. */
export function createSearchProcedure(deps: { db(): DbHandle; embeddings(): EmbeddingsClient }) {
  return workspaceScoped(deps.db).notes.search.handler(({ context, input }) =>
    served(() =>
      searchNotes(context.db.db, context.workspaceId, input, { embeddings: deps.embeddings() }),
    ),
  );
}
