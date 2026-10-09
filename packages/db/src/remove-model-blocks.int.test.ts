import { readFile } from "node:fs/promises";
import { BLOCK_ORIGINS } from "@mastertutor/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.ts";
import { notes, workspaces } from "./schema/index.ts";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let tdb: TestDatabase;
let h: DbHandle;
beforeAll(async () => {
  tdb = await startTestDatabase();
  h = createDb(tdb.ownerUrl);
});
afterAll(async () => {
  await h?.close();
  await tdb?.stop();
});

it("0016 deletes agent annotations, preserves other blocks and rejects model origin", async () => {
  // Restore the removed label to exercise an upgrade with pre-existing annotations.
  await h.sql.unsafe(`ALTER TYPE "public"."block_origin" ADD VALUE 'model' BEFORE 'user'`);
  const [workspace] = await h.db.insert(workspaces).values({ name: "Migration" }).returning();
  const [note] = await h.db
    .insert(notes)
    .values({ workspaceId: workspace!.id, title: "Source and user text" })
    .returning();
  for (const origin of [...BLOCK_ORIGINS, "model"]) {
    await h.sql`
      INSERT INTO note_blocks (note_id, position, type, markdown, origin)
      VALUES (${note!.id}, ${origin}, 'paragraph', ${`Unchanged ${origin} text`}, ${origin})
    `;
  }
  const migration = await readFile(
    new URL("../migrations/0016_remove_model_blocks.sql", import.meta.url),
    "utf8",
  );
  await h.sql.begin(async (tx) => {
    for (const statement of migration.split("--> statement-breakpoint")) {
      await tx.unsafe(statement);
    }
  });
  const blocks =
    await h.sql`SELECT origin, markdown FROM note_blocks WHERE note_id = ${note!.id} ORDER BY origin`;
  expect(blocks).toEqual(
    BLOCK_ORIGINS.map((origin) => ({ origin, markdown: `Unchanged ${origin} text` })),
  );
  const labels = await h.sql`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = 'public.block_origin'::regtype ORDER BY enumsortorder
  `;
  expect(labels.map((row) => row.enumlabel)).toEqual(BLOCK_ORIGINS);
  await expect(h.sql`
    INSERT INTO note_blocks (note_id, position, type, markdown, origin)
    VALUES (${note!.id}, 'rejected', 'paragraph', 'Agent text', 'model')
  `).rejects.toMatchObject({ code: "22P02" });
});
