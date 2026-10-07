import { fakeEmbeddingsClient } from "@mastertutor/contracts/testing";
import {
  createDb,
  type DbHandle,
  noteBlocks,
  notes,
  runEvents,
  runs,
  sources,
} from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import type { Storage } from "@mastertutor/storage";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MaskSources } from "../browser/masking.ts";
import { commitStep, seedRun, startTestStorage, testLogger, testWrite } from "../testing/notes.ts";
import { createAssetStore } from "./assets.ts";
import { createEmbedder } from "./embedder.ts";
import { type BlockDraft, NoteWriter } from "./note-writer.ts";

let tdb: TestDatabase;
let h: DbHandle;
let storage: Storage;
let stopStorage: () => Promise<void>;
beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1"] });
  h = createDb(tdb.agentUrl);
  ({ storage, stop: stopStorage } = await startTestStorage());
});
afterAll(async () => {
  await h?.close();
  await stopStorage?.();
  await tdb?.stop();
});

const block = (markdown: string, extra: Partial<BlockDraft> = {}): BlockDraft => ({
  type: "paragraph",
  markdown,
  origin: "dom",
  assetId: null,
  anchor: null,
  verified: true,
  ...extra,
});
const writer = (fail = false) =>
  new NoteWriter({
    db: h.db,
    embedder: createEmbedder(fakeEmbeddingsClient({ fail }), testLogger),
  });
const ordered = (noteId: string) =>
  h.db
    .select({ id: noteBlocks.id, markdown: noteBlocks.markdown })
    .from(noteBlocks)
    .where(eq(noteBlocks.noteId, noteId))
    .orderBy(sql`${noteBlocks.position} collate "C"`);
const source = (noteId: string, url = "https://example.com/a") => ({
  noteId,
  kind: "web" as const,
  url,
  canonicalUrl: null,
  title: "A",
  faviconAssetId: null,
  mhtmlKey: null,
  screenshotKey: null,
  snapshotSha256: null,
  meta: { coverage: 1 },
});

describe("NoteWriter", () => {
  it("creates one note per run and appends ordered, embedded blocks in the step transaction", async () => {
    const scope = await seedRun(h.db);
    const notesWriter = writer();
    const w = testWrite(scope);
    const noteId = await notesWriter.ensureNote(w, { title: "Plants", lede: "How leaves work" });
    const sourceId = notesWriter.stageSource(w, source(noteId));
    const ids = await notesWriter.appendBlocks(w, {
      noteId,
      sourceId,
      afterBlockId: null,
      blocks: [block("First"), block("Second")],
    });
    notesWriter.stageQuality(w, noteId, 0.99);
    expect(await h.db.select().from(notes).where(eq(notes.id, noteId))).toHaveLength(0);
    expect(w.step.usage.inputTokens).toBe(2);
    await commitStep(h.db, scope.runId, w.step);

    const [run] = await h.db
      .select({ noteId: runs.noteId })
      .from(runs)
      .where(eq(runs.id, scope.runId));
    expect(run?.noteId).toBe(noteId);
    expect(await notesWriter.ensureNote(testWrite(scope), { title: "x", lede: null })).toBe(noteId);
    expect((await ordered(noteId)).map((r) => r.id)).toEqual(ids);
    const embedded = await h.db
      .select({ ok: sql<boolean>`${noteBlocks.embedding} is not null` })
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, noteId));
    expect(embedded.every((r) => r.ok)).toBe(true);
    const [note] = await h.db.select().from(notes).where(eq(notes.id, noteId));
    expect(note).toMatchObject({ fidelity: "verified", coverage: 0.99 });
    const events = await h.db
      .select({ type: runEvents.type })
      .from(runEvents)
      .where(eq(runEvents.runId, scope.runId));
    expect(events.map((e) => e.type)).toEqual(["block_added", "block_added"]);
    expect(
      await notesWriter.findSource(scope, noteId, "web", "https://example.com/a"),
    ).toMatchObject({ sourceId, blockIds: ids });
  });

  it("keeps two appends to one note in one step ordered (W10)", async () => {
    const scope = await seedRun(h.db);
    const notesWriter = writer();
    const w = testWrite(scope);
    const noteId = await notesWriter.ensureNote(w, { title: "N", lede: null });
    const [a] = await notesWriter.appendBlocks(w, {
      noteId,
      sourceId: null,
      afterBlockId: null,
      blocks: [block("A")],
    });
    await notesWriter.appendBlocks(w, {
      noteId,
      sourceId: null,
      afterBlockId: null,
      blocks: [block("C")],
    });
    await notesWriter.appendBlocks(w, {
      noteId,
      sourceId: null,
      afterBlockId: a!,
      blocks: [block("B")],
    });
    await commitStep(h.db, scope.runId, w.step);
    expect((await ordered(noteId)).map((r) => r.markdown)).toEqual(["A", "B", "C"]);
  });

  it("inserts after a given block and needs review for any unverified captured block", async () => {
    const scope = await seedRun(h.db);
    const notesWriter = writer();
    const w1 = testWrite(scope);
    const noteId = await notesWriter.ensureNote(w1, { title: "N", lede: null });
    const [a, b] = await notesWriter.appendBlocks(w1, {
      noteId,
      sourceId: null,
      afterBlockId: null,
      blocks: [block("A"), block("B")],
    });
    await commitStep(h.db, scope.runId, w1.step);
    const w2 = testWrite(scope);
    const [m] = await notesWriter.appendBlocks(w2, {
      noteId,
      sourceId: null,
      afterBlockId: a!,
      blocks: [block("Not on the page", { verified: false })],
    });
    notesWriter.stageQuality(w2, noteId, 1);
    await commitStep(h.db, scope.runId, w2.step);
    expect((await ordered(noteId)).map((r) => r.id)).toEqual([a, m, b]);
    const [note] = await h.db
      .select({ fidelity: notes.fidelity })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(note?.fidelity).toBe("needs_review");
    await expect(
      notesWriter.appendBlocks(testWrite(scope), {
        noteId,
        sourceId: null,
        afterBlockId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        blocks: [block("x")],
      }),
    ).rejects.toMatchObject({ code: "unknown_block" });
  });

  it("marks a note partial when a source lost media", async () => {
    const scope = await seedRun(h.db);
    const notesWriter = writer();
    const w = testWrite(scope);
    const noteId = await notesWriter.ensureNote(w, { title: "N", lede: null });
    notesWriter.stageSource(w, { ...source(noteId), meta: { mediaLost: 1 } });
    notesWriter.stageQuality(w, noteId, 1);
    await commitStep(h.db, scope.runId, w.step);
    const [note] = await h.db
      .select({ fidelity: notes.fidelity })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(note?.fidelity).toBe("partial");
  });

  it("refuses to store a block or title that shows a registered secret", async () => {
    const scope = await seedRun(h.db);
    const notesWriter = writer();
    // B3 seam: the vault's redactor over exact secret values (containsSecret(sources, text) is the predicate).
    const secrets: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text) => text.replaceAll("hunter2", "[secret]"),
    };
    const w = testWrite(scope, secrets);
    await expect(
      notesWriter.ensureNote(w, { title: "Your password is hunter2", lede: null }),
    ).rejects.toMatchObject({ code: "secret_on_page" });
    const noteId = await notesWriter.ensureNote(w, { title: "Account", lede: null });
    await expect(
      notesWriter.appendBlocks(w, {
        noteId,
        sourceId: null,
        afterBlockId: null,
        blocks: [block("pw: hunter2")],
      }),
    ).rejects.toMatchObject({ code: "secret_on_page" });
  });

  it("stores blocks without vectors when embeddings fail, then backfills", async () => {
    const scope = await seedRun(h.db);
    const w = testWrite(scope);
    const noteId = await writer(true).ensureNote(w, { title: "N", lede: null });
    await writer(true).appendBlocks(w, {
      noteId,
      sourceId: null,
      afterBlockId: null,
      blocks: [block("Leaf")],
    });
    await commitStep(h.db, scope.runId, w.step);
    expect(await writer().backfillEmbeddings(noteId)).toBe(1);
    expect(await writer().backfillEmbeddings(noteId)).toBe(0);
  });

  it("stores assets once per workspace (content-addressed)", async () => {
    const scope = await seedRun(h.db);
    const store = createAssetStore({ db: h.db, storage });
    const bytes = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const one = await store.put(scope.workspaceId, {
      bytes,
      mime: "image/svg+xml",
      width: 1,
      height: 1,
      sourceUrl: null,
    });
    const two = await store.put(scope.workspaceId, {
      bytes,
      mime: "image/svg+xml",
      width: 1,
      height: 1,
      sourceUrl: null,
    });
    expect(two.assetId).toBe(one.assetId);
    expect(await storage.head(`assets/${scope.workspaceId}/${one.sha256}`)).not.toBeNull();
  });

  it("rejects notes of other runs and merges source meta in the transaction", async () => {
    const mine = await seedRun(h.db);
    const theirs = await seedRun(h.db);
    const notesWriter = writer();
    const w = testWrite(theirs);
    const noteId = await notesWriter.ensureNote(w, { title: "Theirs", lede: null });
    const sourceId = notesWriter.stageSource(w, {
      ...source(noteId, "https://www.youtube.com/watch?v=x"),
      kind: "youtube",
      meta: { a: 1 },
    });
    notesWriter.stageSourceMeta(w, sourceId, { b: 2 });
    await commitStep(h.db, theirs.runId, w.step);
    await expect(notesWriter.assertRunNote(mine, noteId)).rejects.toMatchObject({
      code: "foreign_note",
    });
    await expect(notesWriter.assertRunNote(theirs, noteId)).resolves.toBeUndefined();
    const [row] = await h.db
      .select({ meta: sources.meta })
      .from(sources)
      .where(eq(sources.id, sourceId));
    expect(row?.meta).toEqual({ a: 1, b: 2, noteId });
  });
});
