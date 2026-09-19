import type { FolderView } from "@mastertutor/contracts";

/** One folder rule for web, fixture and agent (contracts); the DB trigger stays the authority. */
export {
  MAX_FOLDER_DEPTH,
  canCreateFolder,
  canMoveFolder,
  descendantIds,
  folderDepth,
  folderChain as folderPath,
} from "@mastertutor/contracts";

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

/** One level of the tree under `parentId` (null = top level), in the tree's order. */
export function childFolders(
  folders: readonly FolderView[],
  parentId: string | null,
): FolderView[] {
  return folders.filter((f) => f.parentId === parentId).sort(byOrder);
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
