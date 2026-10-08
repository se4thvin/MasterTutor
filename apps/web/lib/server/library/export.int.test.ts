import { assets, createDb, type DbHandle, noteBlocks, notes, workspaces } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildNoteExport } from "./export.ts";

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

describe("buildNoteExport", () => {
  it("zips the Markdown with its assets, workspace-scoped", async () => {
    const out = await buildNoteExport(
      { db: h.db, storage: { getBytes: async () => new Uint8Array([1, 2, 3]) } },
      ws,
      noteId,
    );
    expect(out?.fileName).toBe("Leaves light.zip");
    const files = unzipSync(out!.bytes);
    expect(Object.keys(files).sort()).toEqual(
      [`assets/${"b".repeat(64)}.svg`, "Leaves light.md"].sort(),
    );
    expect(new TextDecoder().decode(files["Leaves light.md"]!)).toMatch(
      /First[\s\S]*!\[Leaf\]\(assets\/b{64}\.svg\)/,
    );
    expect(
      await buildNoteExport(
        { db: h.db, storage: { getBytes: async () => new Uint8Array() } },
        crypto.randomUUID(),
        noteId,
      ),
    ).toBeNull();
  });
});
