import type { FolderView } from "@mastertutor/contracts";
import { canMoveFolder } from "./tree.ts";

/** Same-document drag payload (dataTransfer values are unreadable during dragover). */
export const NOTE_DRAG_TYPE = "application/x-mastertutor-note";
export const FOLDER_DRAG_TYPE = "application/x-mastertutor-folder";

type DraggedItem = { kind: "note"; id: string } | { kind: "folder"; id: string };

let current: DraggedItem | null = null;
export const setDragged = (item: DraggedItem | null) => {
  current = item;
};
export const getDragged = () => current;

/**
 * Whether the item being dragged may drop on `target` (a folder id, or the All notes / Unfiled
 * rows). One rule for tree rows and folder tiles; dropping a folder on its own parent is refused
 * because the request would be a no-op.
 */
export function acceptsDrop(
  target: string,
  folders: readonly FolderView[],
  types: readonly string[],
): boolean {
  const dragged = current;
  if (dragged?.kind === "note" && types.includes(NOTE_DRAG_TYPE)) return target !== "all";
  if (dragged?.kind === "folder" && types.includes(FOLDER_DRAG_TYPE)) {
    if (target === "unfiled") return false;
    const parentId = target === "all" ? null : target;
    const moving = folders.find((f) => f.id === dragged.id);
    if (!moving || moving.parentId === parentId) return false;
    return dragged.id !== target && canMoveFolder(folders, dragged.id, parentId);
  }
  return false;
}
