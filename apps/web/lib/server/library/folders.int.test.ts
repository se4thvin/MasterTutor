import { createDb, type DbHandle, folders, notes, workspaces } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFolderHandler,
  deleteFolderHandler,
  folderTree,
  moveFolderHandler,
  moveNoteHandler,
  renameFolderHandler,
} from "./folders.ts";

let tdb: TestDatabase;
let h: DbHandle;
let ws: string;
beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1"] });
  h = createDb(tdb.webUrl);
  const owner = createDb(tdb.ownerUrl);
  [{ id: ws }] = (await owner.db
    .insert(workspaces)
    .values({ name: "W" })
    .returning({ id: workspaces.id })) as [{ id: string }];
  await owner.close();
});
afterAll(async () => {
  await h?.close();
  await tdb?.stop();
});

describe("folder handlers", () => {
  it("round-trips the contract shapes, checks the shared rule first and maps errors", async () => {
    const a = await createFolderHandler(h.db, ws, { name: "Biology", parentId: null });
    const b = await createFolderHandler(h.db, ws, { name: "Cells", parentId: a.id });
    expect((await folderTree(h.db, ws)).folders.map((f) => f.name).sort()).toEqual([
      "Biology",
      "Cells",
    ]);
    expect(
      (await renameFolderHandler(h.db, ws, { folderId: b.id, name: "Cell biology" })).name,
    ).toBe("Cell biology");
    await expect(
      moveFolderHandler(h.db, ws, { folderId: a.id, parentId: b.id }),
    ).rejects.toMatchObject({ name: "ServiceError", code: "invalid" });
    await expect(
      createFolderHandler(h.db, ws, { name: "Biology", parentId: null }),
    ).rejects.toMatchObject({ code: "conflict" });

    // The shared depth rule answers before the trigger, with a clear message.
    const deep: string[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 8; i++) {
      const folder = await createFolderHandler(h.db, ws, { name: `L${i}`, parentId: parent });
      deep.push(folder.id);
      parent = folder.id;
    }
    await expect(
      createFolderHandler(h.db, ws, { name: "Ninth", parentId: parent }),
    ).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/8 levels/) });
    await expect(
      moveFolderHandler(h.db, ws, { folderId: a.id, parentId: deep[7]! }),
    ).rejects.toMatchObject({ code: "invalid" });

    const [note] = await h.db
      .insert(notes)
      .values({ workspaceId: ws, title: "N" })
      .returning({ id: notes.id });
    expect(await moveNoteHandler(h.db, ws, { noteId: note!.id, folderId: b.id })).toEqual({
      ok: true,
    });
    const [moved] = await h.db
      .select({ filedBy: notes.filedBy, folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, note!.id));
    expect(moved).toEqual({ filedBy: "user", folderId: b.id });

    // Deleting a removes its subtree; the note inside b becomes unfiled.
    expect(await deleteFolderHandler(h.db, ws, { folderId: a.id })).toEqual({ ok: true });
    const [after] = await h.db
      .select({ folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, note!.id));
    expect(after?.folderId).toBeNull();
    expect(await h.db.select().from(folders).where(eq(folders.id, b.id))).toEqual([]);
    await expect(deleteFolderHandler(h.db, ws, { folderId: a.id })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("never reaches another workspace's folders or notes", async () => {
    const owner = createDb(tdb.ownerUrl);
    const [{ id: other }] = (await owner.db
      .insert(workspaces)
      .values({ name: "Other" })
      .returning({ id: workspaces.id })) as [{ id: string }];
    await owner.close();
    const theirs = await createFolderHandler(h.db, other, { name: "Theirs", parentId: null });
    await expect(
      createFolderHandler(h.db, ws, { name: "Child", parentId: theirs.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      moveFolderHandler(h.db, ws, { folderId: theirs.id, parentId: null }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
