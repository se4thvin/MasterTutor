import type { FolderView } from "@mastertutor/contracts";

/** Root folders are depth 1; spec §4 allows at most 8 levels. */
export const MAX_FOLDER_DEPTH = 8;

export interface FolderNode {
  folder: FolderView;
  depth: number;
  children: FolderNode[];
}

const byOrder = (a: FolderView, b: FolderView) => a.sort - b.sort || a.name.localeCompare(b.name);

export function buildFolderTree(folders: readonly FolderView[]): FolderNode[] {
  const childrenOf = new Map<string | null, FolderView[]>();
  for (const folder of folders) {
    const list = childrenOf.get(folder.parentId) ?? [];
    list.push(folder);
    childrenOf.set(folder.parentId, list);
  }
  const known = new Set(folders.map((f) => f.id));
  // Orphans (missing parent) surface at the root instead of disappearing.
  const roots = folders.filter((f) => f.parentId === null || !known.has(f.parentId));
  const build = (
    list: readonly FolderView[],
    depth: number,
    seen: ReadonlySet<string>,
  ): FolderNode[] =>
    [...list]
      .sort(byOrder)
      .filter((f) => !seen.has(f.id))
      .map((folder) => ({
        folder,
        depth,
        children: build(childrenOf.get(folder.id) ?? [], depth + 1, new Set([...seen, folder.id])),
      }));
  return build(roots, 1, new Set());
}

export function folderPath(folders: readonly FolderView[], id: string): FolderView[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: FolderView[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function folderDepth(folders: readonly FolderView[], id: string | null): number {
  return id === null ? 0 : folderPath(folders, id).length;
}

export function descendantIds(folders: readonly FolderView[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId !== null && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        grew = true;
      }
    }
  }
  return result;
}

function subtreeHeight(
  folders: readonly FolderView[],
  id: string,
  seen: Set<string> = new Set(),
): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const heights = folders
    .filter((f) => f.parentId === id)
    .map((c) => subtreeHeight(folders, c.id, seen));
  return 1 + Math.max(0, ...heights);
}

export function canMoveFolder(
  folders: readonly FolderView[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId !== null && descendantIds(folders, folderId).has(newParentId)) return false;
  return folderDepth(folders, newParentId) + subtreeHeight(folders, folderId) <= MAX_FOLDER_DEPTH;
}

export function canCreateFolder(folders: readonly FolderView[], parentId: string | null): boolean {
  return folderDepth(folders, parentId) + 1 <= MAX_FOLDER_DEPTH;
}

export function flattenVisible(
  nodes: readonly FolderNode[],
  expanded: ReadonlySet<string>,
): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (list: readonly FolderNode[]) => {
    for (const node of list) {
      out.push(node);
      if (expanded.has(node.folder.id)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function flattenAll(nodes: readonly FolderNode[]): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (list: readonly FolderNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
