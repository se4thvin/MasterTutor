import { assets, createDb, type DbHandle, noteBlocks, notes, workspaces } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPORT_LIMITS } from "@mastertutor/contracts/export";
import { buildNoteExport, exportNote } from "./export.ts";

let tdb: TestDatabase;
let h: DbHandle;
let ws: string;
let noteId: string;
beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1"] });
  h = createDb(tdb.webUrl);
  const owner = createDb(tdb.ownerUrl);
  [{ id: ws }] = (await owner.db
    .insert(workspaces)
    .values({ name: "W" })
    .returning({ id: workspaces.id })) as [{ id: string }];
  const [asset] = await owner.db
    .insert(assets)
    .values({
      workspaceId: ws,
      sha256: "b".repeat(64),
      bucket: "x",
      key: "assets/k",
      mime: "image/svg+xml",
      bytes: 3,
    })
    .returning({ id: assets.id });
  [{ id: noteId }] = (await owner.db
    .insert(notes)
    .values({ workspaceId: ws, title: "Leaves / light" })
    .returning({ id: notes.id })) as [{ id: string }];
  await owner.db.insert(noteBlocks).values([
    { noteId, position: "a0", type: "paragraph", markdown: "First", origin: "dom", verified: true },
    {
      noteId,
      position: "a1",
      type: "image",
      markdown: "Leaf",
      origin: "dom",
      assetId: asset!.id,
      verified: true,
    },
  ]);
  await owner.close();
});
afterAll(async () => {
  await h?.close();
  await tdb?.stop();
});

const stream = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();

describe("buildNoteExport", () => {
  it("streams the Markdown with its assets, workspace-scoped", async () => {
    const opened: string[] = [];
    const storage = {
      getStream: async (key: string) => (opened.push(key), stream(new Uint8Array([1, 2, 3]))),
    };
    const out = await buildNoteExport({ db: h.db, storage }, ws, noteId);
    expect(out?.fileName).toBe("Leaves light.zip");
    expect(opened).toEqual([]); // nothing is read before the response streams
    const files = unzipSync(new Uint8Array(await new Response(out!.body).arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(
      [`assets/${"b".repeat(64)}.svg`, "Leaves light.md"].sort(),
    );
    expect(new TextDecoder().decode(files["Leaves light.md"]!)).toMatch(
      /First[\s\S]*!\[Leaf\]\(assets\/b{64}\.svg\)/,
    );
    expect(await buildNoteExport({ db: h.db, storage }, crypto.randomUUID(), noteId)).toBeNull();
  });

  it("refuses an export over the size cap before reading anything (13-14 review)", async () => {
    const owner = createDb(tdb.ownerUrl);
    const [big] = await owner.db
      .insert(assets)
      .values({
        workspaceId: ws,
        sha256: "c".repeat(64),
        bucket: "x",
        key: "assets/big",
        mime: "image/png",
        bytes: EXPORT_LIMITS.maxBytes + 1,
      })
      .returning({ id: assets.id });
    const [{ id: bigNote }] = (await owner.db
      .insert(notes)
      .values({ workspaceId: ws, title: "Huge" })
      .returning({ id: notes.id })) as [{ id: string }];
    await owner.db.insert(noteBlocks).values({
      noteId: bigNote,
      position: "a0",
      type: "image",
      markdown: "Big",
      origin: "dom",
      assetId: big!.id,
      verified: true,
    });
    await owner.close();
    let read = false;
    const storage = { getStream: async () => ((read = true), stream(new Uint8Array())) };
    await expect(buildNoteExport({ db: h.db, storage }, ws, bigNote)).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringMatching(/MB/),
    });
    await expect(exportNote(h.db, ws, { noteId: bigNote })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(read).toBe(false);
  });
});
