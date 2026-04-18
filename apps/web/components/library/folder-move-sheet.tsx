"use client";

import type { FolderView } from "@mastertutor/contracts";
import { Sheet } from "@/components/ui/sheet.tsx";
import { buildFolderTree, canMoveFolder, flattenAll } from "@/lib/folders/tree.ts";
import { FolderPickList } from "./folder-pick-list.tsx";
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
  return (
    <Sheet
      open={folder !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Move folder to…"
      description={folder ? `Choose a new parent for “${folder.name}”.` : undefined}
    >
      <FolderPickList
        root={topLevel ? { label: "Top level", icon: "library" } : null}
        folders={rows}
        receiveLabel={folder?.name ?? ""}
        onPick={(parentId) => {
          if (folder) void move(folder.id, parentId);
        }}
        onDone={onClose}
        empty="No other folder can hold this one."
      />
    </Sheet>
  );
}
