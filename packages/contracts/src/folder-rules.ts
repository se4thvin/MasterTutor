/** Spec §4 / D23: folders nest at most 8 levels; root folders are depth 1. The DB trigger is the authority. */
export const MAX_FOLDER_DEPTH = 8;

export interface FolderLink {
  id: string;
  parentId: string | null;
}

/** The folders from the root down to `id`; stops at a cycle or a missing parent. */
export function folderChain<F extends FolderLink>(folders: readonly F[], id: string): F[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: F[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

export function folderDepth(folders: readonly FolderLink[], id: string | null): number {
  return id === null ? 0 : folderChain(folders, id).length;
}

export function descendantIds(folders: readonly FolderLink[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        grew = true;
      }
    }
  }
  return result;
}

export function subtreeHeight(
  folders: readonly FolderLink[],
  id: string,
  seen: Set<string> = new Set(),
): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const heights = folders
    .filter((folder) => folder.parentId === id)
    .map((child) => subtreeHeight(folders, child.id, seen));
  return 1 + Math.max(0, ...heights);
}

export function canMoveFolder(
  folders: readonly FolderLink[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId !== null && descendantIds(folders, folderId).has(newParentId)) return false;
  return folderDepth(folders, newParentId) + subtreeHeight(folders, folderId) <= MAX_FOLDER_DEPTH;
}

export function canCreateFolder(folders: readonly FolderLink[], parentId: string | null): boolean {
  return folderDepth(folders, parentId) + 1 <= MAX_FOLDER_DEPTH;
}
