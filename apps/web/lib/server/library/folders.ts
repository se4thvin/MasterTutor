import {
  canCreateFolder,
  canMoveFolder,
  type CreateFolderInput,
  type FolderRef,
  type FolderView,
  type MoveFolderInput,
  type MoveNoteInput,
  type Ok,
  type RenameFolderInput,
} from "@mastertutor/contracts";
import {
  createFolder,
  type Database,
  deleteFolder,
  FolderError,
  listFolders,
  moveFolder,
  moveNote,
  renameFolder,
} from "@mastertutor/db";
import { ServiceError } from "../service-error.ts";

/** Folder rule violations become the web's typed errors (the same codes). */
async function mapped<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FolderError) throw new ServiceError(error.code, error.message);
    throw error;
  }
}

export async function folderTree(
  db: Database,
  workspaceId: string,
): Promise<{ folders: FolderView[] }> {
  return { folders: await listFolders(db, workspaceId) };
}

/** The shared rule answers first with a clear message; the trigger stays the authority under races. */
export async function createFolderHandler(
  db: Database,
  workspaceId: string,
  input: CreateFolderInput,
): Promise<FolderView> {
  const all = await listFolders(db, workspaceId);
  if (input.parentId !== null && !all.some((f) => f.id === input.parentId))
    throw new ServiceError("not_found", "Folder not found");
  if (!canCreateFolder(all, input.parentId))
    throw new ServiceError("invalid", "Folders can nest at most 8 levels.");
  return mapped(() => createFolder(db, workspaceId, input));
}

export function renameFolderHandler(
  db: Database,
  workspaceId: string,
  input: RenameFolderInput,
): Promise<FolderView> {
  return mapped(() => renameFolder(db, workspaceId, input.folderId, input.name));
}

export async function moveFolderHandler(
  db: Database,
  workspaceId: string,
  input: MoveFolderInput,
): Promise<FolderView> {
  const all = await listFolders(db, workspaceId);
  if (!all.some((f) => f.id === input.folderId))
    throw new ServiceError("not_found", "Folder not found");
  if (input.parentId !== null && !all.some((f) => f.id === input.parentId))
    throw new ServiceError("not_found", "Folder not found");
  if (!canMoveFolder(all, input.folderId, input.parentId))
    throw new ServiceError("invalid", "A folder can't move into itself or deeper than 8 levels.");
  return mapped(() => moveFolder(db, workspaceId, input.folderId, input.parentId));
}

/** Deletes the subtree; notes inside become unfiled (FK set null), as the UI copy says. */
export async function deleteFolderHandler(
  db: Database,
  workspaceId: string,
  input: FolderRef,
): Promise<Ok> {
  await mapped(() => deleteFolder(db, workspaceId, input.folderId));
  return { ok: true };
}

/** Drag-and-drop or "Move to…": the user now owns the filing (spec §7). */
export async function moveNoteHandler(
  db: Database,
  workspaceId: string,
  input: MoveNoteInput,
): Promise<Ok> {
  await mapped(() => moveNote(db, workspaceId, input.noteId, input.folderId, "user"));
  return { ok: true };
}
