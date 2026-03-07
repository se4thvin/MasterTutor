"use client";

import type { NoteSummary } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import { Sheet } from "@/components/ui/sheet.tsx";
import { orpc } from "@/lib/api/client.ts";
import { buildFolderTree, flattenAll } from "@/lib/folders/tree.ts";
import { FolderPickList } from "./folder-pick-list.tsx";
import { useMoveNote } from "./use-move-note.ts";

export function MoveSheet({ note, onClose }: { note: NoteSummary | null; onClose: () => void }) {
  const { data } = useQuery(orpc.folders.tree.queryOptions({ input: {} }));
  const move = useMoveNote();
  const rows = flattenAll(buildFolderTree(data?.folders ?? []));
  const pick = (folderId: string | null) => {
    if (!note) return;
    onClose();
    void move(note.id, folderId, note.folderId);
  };
  return (
    <Sheet
      open={note !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Move to…"
      description={note ? `Choose a folder for “${note.title}”.` : undefined}
    >
      <FolderPickList
        root={{ label: "Unfiled", icon: "unfiled" }}
        folders={rows}
        currentId={note?.folderId}
        onPick={pick}
      />
    </Sheet>
  );
}
