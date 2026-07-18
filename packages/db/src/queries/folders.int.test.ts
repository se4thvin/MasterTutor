import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { notes, workspaces } from "../schema/index.ts";
import { startTestDatabase, type TestDatabase } from "../testing.ts";
import {
  createFolder,
  deleteFolder,
  FolderError,
  folderPaths,
  listFolders,
  moveFolder,
  moveNote,
  renameFolder,
  resolveFolderPath,
} from "./folders.ts";

let tdb: TestDatabase;
let h: DbHandle;
beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1"] });
  h = createDb(tdb.webUrl);
});
afterAll(async () => {
  await h?.close();
  await tdb?.stop();
});

async function workspace(): Promise<string> {
  const [row] = await h.db
    .insert(workspaces)
    .values({ name: "W" })
    .returning({ id: workspaces.id });
  return row!.id;
}

describe("folder queries", () => {
  it("creates a tree and resolves paths exactly, then case-insensitively", async () => {
    const ws = await workspace();
    const bio = await createFolder(h.db, ws, { name: "  Biology ", parentId: null });
    const cells = await createFolder(h.db, ws, { name: "Cells", parentId: bio.id });
    expect(bio.name).toBe("Biology");
    const rows = await listFolders(h.db, ws);
    expect(folderPaths(rows).get(cells.id)).toEqual(["Biology", "Cells"]);
    expect(resolveFolderPath(rows, ["Biology", "Cells"])).toEqual({
      folderId: cells.id,
      matched: 2,
    });
    expect(resolveFolderPath(rows, ["biology", "CELLS"])).toEqual({
      folderId: cells.id,
      matched: 2,
    });
    expect(resolveFolderPath(rows, ["Biology", "Plants", "Leaves"])).toEqual({
      folderId: bio.id,
      matched: 1,
    });
    expect(resolveFolderPath(rows, ["Chemistry"])).toEqual({ folderId: null, matched: 0 });
  });

  it("maps database rule violations to FolderError codes", async () => {
    const ws = await workspace();
    const a = await createFolder(h.db, ws, { name: "A", parentId: null });
    const b = await createFolder(h.db, ws, { name: "B", parentId: a.id });
    await expect(createFolder(h.db, ws, { name: "A", parentId: null })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(moveFolder(h.db, ws, a.id, b.id)).rejects.toMatchObject({ code: "invalid" });
    await expect(createFolder(h.db, ws, { name: "a/b", parentId: null })).rejects.toBeInstanceOf(
      FolderError,
    );
    const other = await workspace();
    await expect(createFolder(h.db, other, { name: "X", parentId: a.id })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(renameFolder(h.db, other, a.id, "Z")).rejects.toMatchObject({ code: "not_found" });
  });

  it("renames, deletes a subtree with its notes unfiled, and moves notes only within the workspace", async () => {
    const ws = await workspace();
    const f = await createFolder(h.db, ws, { name: "Inbox", parentId: null });
    const child = await createFolder(h.db, ws, { name: "Week 1", parentId: f.id });
    expect((await renameFolder(h.db, ws, f.id, "Reading")).name).toBe("Reading");
    const [note] = await h.db
      .insert(notes)
      .values({ workspaceId: ws, title: "N" })
      .returning({ id: notes.id });
    await moveNote(h.db, ws, note!.id, child.id, "user");
    const foreign = await createFolder(h.db, await workspace(), { name: "Other", parentId: null });
    await expect(moveNote(h.db, ws, note!.id, foreign.id, "user")).rejects.toMatchObject({
      code: "not_found",
    });
    await deleteFolder(h.db, ws, f.id);
    expect(await listFolders(h.db, ws)).toEqual([]);
    const [unfiled] = await h.db
      .select({ folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, note!.id));
    expect(unfiled?.folderId).toBeNull();
    await expect(deleteFolder(h.db, ws, f.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
