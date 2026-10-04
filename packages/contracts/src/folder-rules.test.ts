import { describe, expect, it } from "vitest";
import { FilingDecision } from "./agent-turn.ts";
import {
  MAX_FOLDER_DEPTH,
  canCreateFolder,
  canMoveFolder,
  descendantIds,
  folderChain,
  folderDepth,
  subtreeHeight,
} from "./folder-rules.ts";

const chain = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i}`, parentId: i === 0 ? null : `f${i - 1}` }));

describe("folder rules (one rule for web, fixture and agent; the DB trigger stays the authority)", () => {
  it("measures depth and subtree height", () => {
    const tree = chain(3);
    expect(folderChain(tree, "f2").map((f) => f.id)).toEqual(["f0", "f1", "f2"]);
    expect(folderDepth(tree, null)).toBe(0);
    expect(folderDepth(tree, "f2")).toBe(3);
    expect(subtreeHeight(tree, "f0")).toBe(3);
    expect([...descendantIds(tree, "f1")].sort()).toEqual(["f1", "f2"]);
  });
  it("refuses cycles and a ninth level", () => {
    const tree = chain(MAX_FOLDER_DEPTH);
    expect(canMoveFolder(tree, "f0", "f3")).toBe(false);
    expect(canCreateFolder(tree, "f6")).toBe(true);
    expect(canCreateFolder(tree, "f7")).toBe(false);
    const extra = [...chain(2), { id: "x", parentId: null }];
    expect(canMoveFolder(extra, "f0", "x")).toBe(true);
  });
  it("survives a cyclic input without looping", () => {
    const cyclic = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    expect(folderChain(cyclic, "a").length).toBeLessThanOrEqual(2);
    expect(subtreeHeight(cyclic, "a")).toBeLessThanOrEqual(2);
  });
  it("bounds the filing model's path by the same limit", () => {
    expect(
      FilingDecision.safeParse({ path: Array(MAX_FOLDER_DEPTH + 1).fill("a"), createLeaf: true })
        .success,
    ).toBe(false);
  });
});
