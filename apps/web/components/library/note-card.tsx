"use client";

import type { NoteSummary } from "@mastertutor/contracts";
import Link from "next/link";
import type { CSSProperties } from "react";
import { IconButton } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import { NOTE_DRAG_TYPE, setDragged } from "@/lib/folders/drag.ts";
import type { LibraryViewMode } from "@/lib/library/params.ts";
import { KIND_LABEL, formatDate, noteKindIcon } from "@/lib/notes/format.ts";
import { FidelityBadge } from "./fidelity-badge.tsx";
import { NoteArt, artFor } from "./note-art.tsx";

export function NoteCard({
  note,
  view,
  index,
  onMove,
  onDelete,
}: {
  note: NoteSummary;
  view: LibraryViewMode;
  index: number;
  onMove: (note: NoteSummary) => void;
  onDelete: (note: NoteSummary) => void;
}) {
  const kind = note.sourceKinds[0] ?? "web";
  return (
    <article
      className="card"
      data-qa="note-card"
      draggable
      style={{ "--i": Math.min(index, 12) } as CSSProperties}
      onDragStart={(e) => {
        setDragged({ kind: "note", id: note.id });
        e.dataTransfer.setData(NOTE_DRAG_TYPE, note.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => setDragged(null)}
    >
      <div className="card-cover">
        <NoteArt name={artFor(note.id, kind)} />
        {view === "grid" ? (
          <span className="card-badge">
            <FidelityBadge fidelity={note.fidelity} coverage={note.coverage} />
          </span>
        ) : null}
      </div>
      <div className="card-body">
        <p className="card-meta">
          <Icon name={noteKindIcon(note)} size="sm" />
          <span>{KIND_LABEL[kind]}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDate(note.createdAt)}</span>
        </p>
        <h3 className="card-title">
          {/* The card, not the link, is the drag source: a draggable link would carry only its URL. */}
          <Link href={`/notes/${note.id}`} className="card-link" draggable={false}>
            {note.title}
          </Link>
        </h3>
        {note.lede ? <p className="card-lede">{note.lede}</p> : null}
      </div>
      {view === "list" ? (
        <span className="card-list-badge">
          <FidelityBadge fidelity={note.fidelity} coverage={note.coverage} />
        </span>
      ) : null}
      <div className="card-menu">
        <Menu.Root>
          <Menu.Trigger render={<IconButton icon="more" label={`Actions for ${note.title}`} />} />
          <MenuPanel>
            <MenuItem icon="move" onSelect={() => onMove(note)}>
              Move to…
            </MenuItem>
            <MenuItem icon="delete" destructive onSelect={() => onDelete(note)}>
              Delete note…
            </MenuItem>
          </MenuPanel>
        </Menu.Root>
      </div>
    </article>
  );
}
