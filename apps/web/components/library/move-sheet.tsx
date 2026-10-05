"use client";

import type { NoteSummary } from "@mastertutor/contracts";
import { Sheet } from "@/components/ui/sheet.tsx";
import { buildFolderTree, flattenAll } from "@/lib/folders/tree.ts";
import { FolderPickList } from "./folder-pick-list.tsx";
import { useFolders } from "./use-folders.ts";
import { useMoveNote } from "./use-move-note.ts";

export function MoveSheet({ note, onClose }: { note: NoteSummary | null; onClose: () => void }) {
  const folders = useFolders();
  const move = useMoveNote();
  const rows = flattenAll(buildFolderTree(folders));
  return (
    <Sheet
      open={note !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Move to…"
      description={note ? `Choose a folder for “${note.title}”.` : undefined}
    >
      <FolderPickList
        key={note?.id ?? "none"}
        root={{ label: "Unfiled", icon: "unfiled" }}
        folders={rows}
        currentId={note?.folderId}
        receiveLabel={note?.title ?? ""}
        onPick={(folderId) => {
          if (note) void move(note.id, folderId, note.folderId);
        }}
        onDone={onClose}
      />
    </Sheet>
  );
}
