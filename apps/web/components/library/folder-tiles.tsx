"use client";

import type { FolderView } from "@mastertutor/contracts";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { FolderFloat } from "@/components/bits/folder-float.tsx";
import { acceptsDrop, getDragged, setDragged } from "@/lib/folders/drag.ts";
import { childFolders } from "@/lib/folders/tree.ts";
import { libraryHref, type LibraryParams } from "@/lib/library/params.ts";
import { durations } from "@/lib/motion-tokens.ts";
import { useMoveFolder } from "./use-move-folder.ts";

const subfolderLabel = (n: number) => (n === 0 ? undefined : `${n} folder${n === 1 ? "" : "s"}`);

/**
 * The current folder's subfolders as tiles. Each is a link (Enter opens it) and a drop target for
 * notes and folders; the non-drag path is "Move to…" (WCAG 2.5.7). The lid lifts while a drop
 * hovers and the folder gulps when it takes one.
 */
export function FolderTiles({
  folders,
  parentId,
  params,
  onDropNote,
}: {
  folders: FolderView[];
  parentId: string | null;
  /** The library's current params; a tile keeps the view and kind and opens its folder. */
  params: LibraryParams;
  onDropNote: (noteId: string, folderId: string) => void;
}) {
  const titleId = useId();
  const moveFolder = useMoveFolder();
  const [dropId, setDropId] = useState<string | null>(null);
  const [receivedId, setReceivedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const tiles = childFolders(folders, parentId);
  if (tiles.length === 0) return null;

  const onDrop = (folderId: string, event: DragEvent) => {
    event.preventDefault();
    setDropId(null);
    // Decide before clearing the dragged item: acceptsDrop reads it.
    const dragged = getDragged();
    const accepted = dragged !== null && acceptsDrop(folderId, folders, event.dataTransfer.types);
    setDragged(null);
    if (!dragged || !accepted) return;
    if (dragged.kind === "note") onDropNote(dragged.id, folderId);
    else void moveFolder(dragged.id, folderId);
    clearTimeout(timer.current);
    setReceivedId(folderId);
    timer.current = setTimeout(() => setReceivedId(null), durations.receive);
  };

  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="eyebrow ftiles-title">
        Folders
      </h2>
      <ul className="ftiles">
        {tiles.map((folder) => {
          const sublabel = subfolderLabel(childFolders(folders, folder.id).length);
          return (
            <li key={folder.id}>
              <Link
                // Flex children would otherwise join as "Papers 2 folders" (or "Papers2 folders").
                aria-label={sublabel ? `${folder.name}, ${sublabel}` : undefined}
                href={libraryHref({ ...params, folder: folder.id, q: "" })}
                className="ftile"
                data-qa="folder-tile"
                draggable={false}
                onDragOver={(e) => {
                  if (!acceptsDrop(folder.id, folders, e.dataTransfer.types)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropId(folder.id);
                }}
                onDragLeave={(e) => {
                  // Crossing the tile's own label fires leave/enter pairs; only a real exit counts.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setDropId((id) => (id === folder.id ? null : id));
                }}
                onDrop={(e) => onDrop(folder.id, e)}
              >
                <FolderFloat
                  label={folder.name}
                  sublabel={sublabel}
                  open={dropId === folder.id}
                  receiving={receivedId === folder.id}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
