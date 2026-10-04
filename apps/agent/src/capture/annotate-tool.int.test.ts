import { createDb, type DbHandle, noteBlocks } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LibraryServices } from "../library.ts";
import { fakeLibraryServices } from "../testing/library.ts";
import { commitStep, seedRun, testWrite } from "../testing/notes.ts";
import { testToolContext } from "../testing/tool-context.ts";
import { createAnnotateTool } from "./annotate-tool.ts";

let tdb: TestDatabase;
let h: DbHandle;
let services: LibraryServices;
beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1"] });
  h = createDb(tdb.agentUrl);
  services = fakeLibraryServices(h.db);
});
afterAll(async () => {
  await h?.close();
  await tdb?.stop();
});

async function runWithNote() {
  const scope = await seedRun(h.db);
  const w = testWrite(scope);
  const noteId = await services.writer.ensureNote(w, { title: "N", lede: null });
  const [first, second] = await services.writer.appendBlocks(w, {
    noteId,
    sourceId: null,
    afterBlockId: null,
    blocks: ["A", "B"].map((markdown) => ({
      type: "paragraph" as const,
      markdown,
      origin: "dom" as const,
      assetId: null,
      anchor: null,
      verified: true,
    })),
  });
  await commitStep(h.db, scope.runId, w.step);
  return { scope, noteId, first: first!, second: second! };
}
const ctxFor = (scope: { runId: string; workspaceId: string }) =>
  testToolContext({ ...scope, session: {} as never });

describe("annotate", () => {
  it("adds model-origin blocks after a block or at the end", async () => {
    const { scope, noteId, first, second } = await runWithNote();
    const tool = createAnnotateTool(services);
    const ctx = ctxFor(scope);
    expect(tool.untrusted).toBe(false);
    const { blockId: heading } = await tool.run(ctx, {
      noteId,
      afterBlockId: first,
      markdown: "Key ideas",
      kind: "heading",
    });
    const { blockId: summary } = await tool.run(ctx, {
      noteId,
      afterBlockId: null,
      markdown: "Leaves capture light.",
      kind: "summary",
    });
    await commitStep(h.db, scope.runId, ctx.step);
    const rows = await h.db
      .select({
        id: noteBlocks.id,
        type: noteBlocks.type,
        origin: noteBlocks.origin,
        markdown: noteBlocks.markdown,
        verified: noteBlocks.verified,
      })
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, noteId))
      .orderBy(sql`${noteBlocks.position} collate "C"`);
    expect(rows.map((r) => r.id)).toEqual([first, heading, second, summary]);
    expect(rows[1]).toMatchObject({
      type: "heading",
      origin: "model",
      markdown: "## Key ideas",
      verified: false,
    });
    expect(rows[3]).toMatchObject({ type: "commentary", origin: "model" });
  });

  it("refuses notes of other runs and blocks of other notes with typed errors", async () => {
    const mine = await runWithNote();
    const theirs = await runWithNote();
    const tool = createAnnotateTool(services);
    await expect(
      tool.run(ctxFor(mine.scope), {
        noteId: theirs.noteId,
        afterBlockId: null,
        markdown: "x",
        kind: "commentary",
      }),
    ).rejects.toMatchObject({ name: "ToolError", code: "foreign_note" });
    await expect(
      tool.run(ctxFor(mine.scope), {
        noteId: mine.noteId,
        afterBlockId: theirs.first,
        markdown: "x",
        kind: "commentary",
      }),
    ).rejects.toMatchObject({ name: "ToolError", code: "unknown_block" });
  });
});
