"use client";

import type { FolderView } from "@mastertutor/contracts";
import { Icon } from "@/components/ui/icon.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { buildFolderTree, canMoveFolder, flattenAll } from "@/lib/folders/tree.ts";
import { useMoveFolder } from "./use-move-folder.ts";

/** The non-drag way to reparent a folder (WCAG 2.5.7). Only legal destinations are listed. */
export function FolderMoveSheet({
  folder,
  folders,
  onClose,
}: {
  folder: FolderView | null;
  folders: FolderView[];
  onClose: () => void;
}) {
  const move = useMoveFolder();
  const rows = folder
    ? flattenAll(buildFolderTree(folders)).filter(
        (node) =>
          node.folder.id !== folder.id &&
          node.folder.id !== folder.parentId &&
          canMoveFolder(folders, folder.id, node.folder.id),
      )
    : [];
  const topLevel = folder !== null && folder.parentId !== null;
  const pick = (parentId: string | null) => {
    if (!folder) return;
    onClose();
    void move(folder.id, parentId);
  };
  return (
    <Sheet
      open={folder !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Move folder to…"
      description={folder ? `Choose a new parent for “${folder.name}”.` : undefined}
    >
      <ul className="move-list">
        {topLevel ? (
          <li>
            <button type="button" className="move-row" onClick={() => pick(null)}>
              <Icon name="library" size="sm" />
              <span>Top level</span>
            </button>
          </li>
        ) : null}
        {rows.map((node) => (
          <li key={node.folder.id}>
            <button
              type="button"
              className="move-row"
              style={{ paddingInlineStart: `${0.75 + (node.depth - 1) * 1}rem` }}
              onClick={() => pick(node.folder.id)}
            >
              <Icon name="folder" size="sm" />
              <span>{node.folder.name}</span>
            </button>
          </li>
        ))}
        {!topLevel && rows.length === 0 ? (
          <li className="move-empty">No other folder can hold this one.</li>
        ) : null}
      </ul>
    </Sheet>
  );
}
