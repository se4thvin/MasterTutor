import type { FolderView } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import {
  MAX_FOLDER_DEPTH,
  buildFolderTree,
  canCreateFolder,
  canMoveFolder,
  descendantIds,
  flattenVisible,
  folderDepth,
  folderPath,
} from "./tree.ts";

const f = (id: string, parentId: string | null, name = id, sort = 0): FolderView => ({
  id,
  parentId,
  name,
  sort,
});
const folders = [f("a", null, "Alpha", 1), f("b", "a"), f("c", "b"), f("d", null, "Delta", 0)];

describe("folder tree", () => {
  it("builds a sorted tree with depths", () => {
    const tree = buildFolderTree(folders);
    expect(tree.map((n) => n.folder.id)).toEqual(["d", "a"]);
    expect(tree[1]?.children[0]?.children[0]).toMatchObject({ depth: 3, folder: { id: "c" } });
  });

  it("finds paths and depths", () => {
    expect(folderPath(folders, "c").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(folderDepth(folders, "c")).toBe(3);
    expect(folderDepth(folders, null)).toBe(0);
    expect([...descendantIds(folders, "a")].sort()).toEqual(["a", "b", "c"]);
  });

  it("refuses moving a folder into itself or a descendant (Review Focus 4)", () => {
    expect(canMoveFolder(folders, "a", "a")).toBe(false);
    expect(canMoveFolder(folders, "a", "c")).toBe(false);
    expect(canMoveFolder(folders, "c", "d")).toBe(true);
    expect(canMoveFolder(folders, "b", null)).toBe(true);
  });

  it("refuses moves and creates past depth 8", () => {
    const chain = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) =>
      f(`l${i}`, i === 0 ? null : `l${i - 1}`),
    );
    expect(canCreateFolder(chain, "l7")).toBe(false);
    expect(canCreateFolder(chain, "l6")).toBe(true);
    // Moving the a→b→c subtree (3 levels) under l5 (depth 6) would reach depth 9.
    expect(canMoveFolder([...chain, ...folders], "a", "l5")).toBe(false);
    expect(canMoveFolder([...chain, ...folders], "a", "l4")).toBe(true);
  });

  it("survives a corrupt cycle without looping", () => {
    const cyclic = [f("x", "y"), f("y", "x")];
    expect(folderPath(cyclic, "x").length).toBeLessThanOrEqual(2);
    expect(() => buildFolderTree(cyclic)).not.toThrow();
  });

  it("flattens only expanded branches", () => {
    const tree = buildFolderTree(folders);
    expect(flattenVisible(tree, new Set()).map((n) => n.folder.id)).toEqual(["d", "a"]);
    expect(flattenVisible(tree, new Set(["a"])).map((n) => n.folder.id)).toEqual(["d", "a", "b"]);
  });
});
