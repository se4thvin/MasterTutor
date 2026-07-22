import type { FolderView } from "@mastertutor/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FOLDER_DRAG_TYPE, NOTE_DRAG_TYPE, acceptsDrop, setDragged } from "./drag.ts";

const f = (id: string, parentId: string | null): FolderView => ({
  id,
  parentId,
  name: id,
  sort: 0,
});
const folders = [f("a", null), f("b", "a"), f("c", "b"), f("d", null)];

afterEach(() => setDragged(null));

describe("acceptsDrop", () => {
  it("takes a note anywhere except All notes", () => {
    setDragged({ kind: "note", id: "n1" });
    expect(acceptsDrop("d", folders, [NOTE_DRAG_TYPE])).toBe(true);
    expect(acceptsDrop("unfiled", folders, [NOTE_DRAG_TYPE])).toBe(true);
    expect(acceptsDrop("all", folders, [NOTE_DRAG_TYPE])).toBe(false);
  });

  it("refuses a folder dropped into itself, its subtree, its current parent or Unfiled", () => {
    setDragged({ kind: "folder", id: "b" });
    expect(acceptsDrop("b", folders, [FOLDER_DRAG_TYPE])).toBe(false);
    expect(acceptsDrop("c", folders, [FOLDER_DRAG_TYPE])).toBe(false);
    expect(acceptsDrop("a", folders, [FOLDER_DRAG_TYPE])).toBe(false);
    expect(acceptsDrop("unfiled", folders, [FOLDER_DRAG_TYPE])).toBe(false);
    expect(acceptsDrop("d", folders, [FOLDER_DRAG_TYPE])).toBe(true);
    expect(acceptsDrop("all", folders, [FOLDER_DRAG_TYPE])).toBe(true);
  });

  it("refuses drags from outside the app (no matching type) and drags with nothing tracked", () => {
    setDragged({ kind: "note", id: "n1" });
    expect(acceptsDrop("d", folders, ["text/uri-list"])).toBe(false);
    setDragged(null);
    expect(acceptsDrop("d", folders, [NOTE_DRAG_TYPE])).toBe(false);
  });
});
