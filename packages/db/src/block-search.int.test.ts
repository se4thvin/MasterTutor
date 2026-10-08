import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.ts";
import { noteBlocks, notes, workspaces } from "./schema/index.ts";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let tdb: TestDatabase;
let h: DbHandle;
beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1"] });
  h = createDb(tdb.agentUrl);
});
afterAll(async () => {
  await h?.close();
  await tdb?.stop();
});

describe("note_blocks.search", () => {
  it("is generated from markdown and GIN-indexed", async () => {
    const migration = await readFile(
      new URL("../migrations/0011_block_search.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toMatch(/ADD COLUMN "search" "?tsvector"? GENERATED ALWAYS AS/);
    expect(migration).toMatch(/CREATE INDEX "note_blocks_search_idx" ON "note_blocks" USING gin/);

    const [ws] = await h.db
      .insert(workspaces)
      .values({ name: "W" })
      .returning({ id: workspaces.id });
    const [note] = await h.db
      .insert(notes)
      .values({ workspaceId: ws!.id, title: "Plants" })
      .returning({ id: notes.id });
    await h.db.insert(noteBlocks).values({
      noteId: note!.id,
      position: "a0",
      type: "paragraph",
      markdown: "Chlorophyll absorbs **red** and blue light.",
      origin: "dom",
    });
    const rows = await h.db.execute(
      sql`select markdown from note_blocks where search @@ websearch_to_tsquery('english', 'chlorophyll absorbs')`,
    );
    expect(rows).toHaveLength(1);
  });
});
