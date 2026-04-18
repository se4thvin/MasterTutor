"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { IconName } from "@/components/ui/icon.tsx";
import type { FolderNode } from "@/lib/folders/tree.ts";
import { durations } from "@/lib/motion-tokens.ts";
import { FolderMark } from "./folder-mark.tsx";

/**
 * The folder picker both move sheets use: an optional root destination (Unfiled or Top level),
 * then each folder indented by depth. The current location is marked with aria-current.
 * A pick starts the move at once (onPick); the chosen folder lifts its lid and the item flies in,
 * then onDone closes the sheet. Reduced motion, or picking where it already is, skips straight to
 * onDone. While receiving, further picks are ignored (one move, one toast).
 */
export function FolderPickList({
  root,
  folders,
  currentId,
  onPick,
  onDone,
  receiveLabel,
  empty,
}: {
  root?: { label: string; icon: IconName } | null;
  folders: FolderNode[];
  /** The folder the item is in now; null means the root. Undefined marks nothing. */
  currentId?: string | null;
  onPick: (folderId: string | null) => void;
  onDone: () => void;
  /** What flies into the chosen folder: the note title or the folder name. */
  receiveLabel: string;
  empty?: string;
}) {
  const reduce = useReducedMotion();
  const [receiving, setReceiving] = useState<{ id: string | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pick = (id: string | null) => {
    if (receiving) return;
    onPick(id);
    if (reduce || id === currentId) {
      onDone();
      return;
    }
    setReceiving({ id });
    timer.current = setTimeout(onDone, durations.receive);
  };

  const row = (
    id: string | null,
    label: string,
    icon: IconName,
    openIcon: IconName | null,
    indent?: string,
  ) => {
    const here = receiving !== null && receiving.id === id;
    return (
      <button
        type="button"
        className="move-row"
        style={indent ? { paddingInlineStart: indent } : undefined}
        aria-current={currentId === id ? "true" : undefined}
        aria-disabled={receiving ? true : undefined}
        onClick={() => pick(id)}
      >
        <span className="move-target">
          <FolderMark name={icon} openName={openIcon} lift={here} />
          {here ? (
            <span className="move-pill" aria-hidden="true">
              {receiveLabel}
            </span>
          ) : null}
        </span>
        <span className="move-label">{label}</span>
      </button>
    );
  };

  return (
    <ul className="move-list">
      {root ? <li>{row(null, root.label, root.icon, null)}</li> : null}
      {folders.map((node) => (
        <li key={node.folder.id}>
          {row(
            node.folder.id,
            node.folder.name,
            "folder",
            "folderOpen",
            `${0.75 + (node.depth - 1) * 1}rem`,
          )}
        </li>
      ))}
      {!root && folders.length === 0 && empty ? <li className="move-empty">{empty}</li> : null}
    </ul>
  );
}
