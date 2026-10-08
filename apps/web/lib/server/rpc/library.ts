import type { EmbeddingsClient } from "@mastertutor/contracts/server";
import type { DbHandle } from "@mastertutor/db";
import { exportNote } from "../library/export.ts";
import {
  createFolderHandler,
  deleteFolderHandler,
  folderTree,
  moveFolderHandler,
  moveNoteHandler,
  renameFolderHandler,
} from "../library/folders.ts";
import { deleteNote, getNote, listNotes, markVerified, updateBlock } from "../library/notes.ts";
import { assetUrl } from "../library/objects.ts";
import { searchNotes } from "../library/search.ts";
import { served } from "../service-error.ts";
import { workspaceScoped } from "./workspace-scope.ts";

/**
 * notes.*, folders.* and assets.url over B2's handlers and notes.ts. requireViewer and
 * workspaceScoped have already resolved the session and the workspace: every handler takes them
 * from the context (no second session or membership read).
 */
export function createLibraryProcedures(deps: { db(): DbHandle; embeddings(): EmbeddingsClient }) {
  const scoped = workspaceScoped(deps.db);
  return {
    notes: {
      list: scoped.notes.list.handler(({ context, input }) =>
        served(() => listNotes(context.db.db, context.workspaceId, input)),
      ),
      get: scoped.notes.get.handler(({ context, input }) =>
        served(() => getNote(context.db.db, context.workspaceId, input)),
      ),
      updateBlock: scoped.notes.updateBlock.handler(({ context, input }) =>
        served(() => updateBlock(context.db.db, context.workspaceId, input)),
      ),
      markVerified: scoped.notes.markVerified.handler(({ context, input }) =>
        served(() => markVerified(context.db.db, context.workspaceId, input)),
      ),
      move: scoped.notes.move.handler(({ context, input }) =>
        served(() => moveNoteHandler(context.db.db, context.workspaceId, input)),
      ),
      delete: scoped.notes.delete.handler(({ context, input }) =>
        served(() => deleteNote(context.db.db, context.workspaceId, input)),
      ),
      export: scoped.notes.export.handler(({ context, input }) =>
        served(() => exportNote(context.db.db, context.workspaceId, input)),
      ),
      search: scoped.notes.search.handler(({ context, input }) =>
        served(() =>
          searchNotes(context.db.db, context.workspaceId, input, {
            embeddings: deps.embeddings(),
          }),
        ),
      ),
    },
    folders: {
      tree: scoped.folders.tree.handler(({ context }) =>
        served(() => folderTree(context.db.db, context.workspaceId)),
      ),
      create: scoped.folders.create.handler(({ context, input }) =>
        served(() => createFolderHandler(context.db.db, context.workspaceId, input)),
      ),
      rename: scoped.folders.rename.handler(({ context, input }) =>
        served(() => renameFolderHandler(context.db.db, context.workspaceId, input)),
      ),
      move: scoped.folders.move.handler(({ context, input }) =>
        served(() => moveFolderHandler(context.db.db, context.workspaceId, input)),
      ),
      delete: scoped.folders.delete.handler(({ context, input }) =>
        served(() => deleteFolderHandler(context.db.db, context.workspaceId, input)),
      ),
    },
    assets: {
      url: scoped.assets.url.handler(({ context, input }) =>
        served(() => assetUrl(context.db.db, context.workspaceId, input)),
      ),
    },
  };
}
