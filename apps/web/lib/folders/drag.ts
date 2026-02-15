/** Same-document drag payload (dataTransfer values are unreadable during dragover). */
export const NOTE_DRAG_TYPE = "application/x-mastertutor-note";
export const FOLDER_DRAG_TYPE = "application/x-mastertutor-folder";

export type DraggedItem = { kind: "note"; id: string } | { kind: "folder"; id: string };

let current: DraggedItem | null = null;
export const setDragged = (item: DraggedItem | null) => {
  current = item;
};
export const getDragged = () => current;
