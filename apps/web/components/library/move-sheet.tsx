"use client";

import type { NoteSummary } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/icon.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { orpc } from "@/lib/api/client.ts";
import { buildFolderTree, flattenAll } from "@/lib/folders/tree.ts";
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
      <ul className="move-list">
        <li>
          <button
            type="button"
            className="move-row"
            aria-current={note?.folderId === null ? "true" : undefined}
            onClick={() => pick(null)}
          >
            <Icon name="unfiled" size="sm" />
            <span>Unfiled</span>
          </button>
        </li>
        {rows.map((node) => (
          <li key={node.folder.id}>
            <button
              type="button"
              className="move-row"
              style={{ paddingInlineStart: `${0.75 + (node.depth - 1) * 1}rem` }}
              aria-current={note?.folderId === node.folder.id ? "true" : undefined}
              onClick={() => pick(node.folder.id)}
            >
              <Icon name="folder" size="sm" />
              <span>{node.folder.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
