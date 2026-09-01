import { MAX_ASSET_BYTES } from "@mastertutor/contracts";
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
import { EventEmitter } from "node:events";
import type { CDPSession } from "playwright-core";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import { createSecretFingerprints } from "../vault/fingerprints.ts";
import { commitStep, seedRun, startTestStorage, testLogger, testWrite } from "../testing/notes.ts";
import { createAssetStore } from "./assets.ts";
import { createEmbedder } from "./embedder.ts";
import { type BlockDraft, NoteWriter, timeAnchor } from "./note-writer.ts";

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
    // B3 seam: the vault's redactor over exact secret values (containsSecret(sources, text) is the predicate).
    const secrets: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text) => text.replaceAll("hunter2", "[secret]"),
    };
    const client = fakeEmbeddingsClient();
    const screened = new NoteWriter({ db: h.db, embedder: createEmbedder(client, testLogger) });
    const w = testWrite(scope, secrets);
    await expect(
      screened.ensureNote(w, { title: "Your password is hunter2", lede: null }),
    ).rejects.toMatchObject({ code: "secret_on_page" });
    const noteId = await screened.ensureNote(w, { title: "Account", lede: null });
    await expect(
      screened.appendBlocks(w, {
        noteId,
        sourceId: null,
        afterBlockId: null,
        blocks: [block("pw: hunter2")],
      }),
    ).rejects.toMatchObject({ code: "secret_on_page" });
    // Screened before anything else: never sent to OpenAI, no block row staged (only the note).
    expect(client.calls).toEqual([]);
    expect(w.step.events.filter((e) => e.type === "block_added")).toEqual([]);
  });

  it("screens URLs, meta, anchors and asset source URLs, percent-encoded too (review I4)", async () => {
    const scope = await seedRun(h.db);
    const prints = createSecretFingerprints();
    const secret = "MARMOT4CANARY8VELVET";
    prints.remember(scope.runId, {
      filled: {
        cdp: new EventEmitter() as unknown as CDPSession,
        frameId: "main",
        loaderId: "doc",
        backendNodeIds: [1],
      },
      secret,
    });
    const w = testWrite(scope, prints.forRun(scope.runId));
    const notesWriter = writer();
    const noteId = await notesWriter.ensureNote(w, { title: "Login", lede: null });
    const encoded = "MARMOT4%43ANARY8VELVET";
    const refused = { code: "secret_on_page" };
    expect(() =>
      notesWriter.stageSource(w, source(noteId, `https://example.com/login?pw=${secret}`)),
    ).toThrow(expect.objectContaining(refused));
    expect(() =>
      notesWriter.stageSource(w, source(noteId, `https://example.com/login?pw=${encoded}`)),
    ).toThrow(expect.objectContaining(refused));
    expect(() =>
      notesWriter.stageSource(w, {
        ...source(noteId),
        canonicalUrl: `https://example.com/?next=%2Fa%3Fpw%3D${encoded}`,
      }),
    ).toThrow(expect.objectContaining(refused));
    expect(() =>
      notesWriter.stageSource(w, { ...source(noteId), meta: { echo: `pw ${secret}` } }),
    ).toThrow(expect.objectContaining(refused));
    const sourceId = notesWriter.stageSource(w, source(noteId));
    expect(() => notesWriter.stageSourceMeta(w, sourceId, { echo: secret })).toThrow(
      expect.objectContaining(refused),
    );
    const anchor = {
      selector: `input[value="${secret}"]`,
      xpath: null,
      start: null,
      end: null,
      textFragment: null,
    };
    await expect(
      notesWriter.appendBlocks(w, {
        noteId,
        sourceId,
        afterBlockId: null,
        blocks: [block("Plain text", { anchor })],
      }),
    ).rejects.toMatchObject(refused);
    const store = createAssetStore({ db: h.db, storage });
    await expect(
      store.put(
        scope.workspaceId,
        {
          bytes: new Uint8Array([1]),
          mime: "image/png",
          width: 1,
          height: 1,
          sourceUrl: `https://example.com/x.png?pw=${encoded}`,
        },
        w.secrets,
      ),
    ).rejects.toMatchObject(refused);
  });

  it("scopes every query and write to the run's workspace (review I3)", async () => {
    const mine = await seedRun(h.db);
    const theirs = await seedRun(h.db);
    const theirWrite = testWrite(theirs);
    // One writer per step, as in production (staged notes are tracked per writer).
    const theirWriter = writer(true);
    const theirNote = await theirWriter.ensureNote(theirWrite, { title: "Theirs", lede: null });
    const theirSource = theirWriter.stageSource(theirWrite, source(theirNote));
    await theirWriter.appendBlocks(theirWrite, {
      noteId: theirNote,
      sourceId: theirSource,
      afterBlockId: null,
      blocks: [block("Their text")],
    });
    theirWriter.stageQuality(theirWrite, theirNote, 0.9);
    await commitStep(h.db, theirs.runId, theirWrite.step);

    const w = testWrite(mine);
    await expect(
      writer().appendBlocks(w, {
        noteId: theirNote,
        sourceId: null,
        afterBlockId: null,
        blocks: [block("Injected")],
      }),
    ).rejects.toMatchObject({ code: "foreign_note" });
    writer().stageSourceMeta(w, theirSource, { hijacked: true });
    writer().stageQuality(w, theirNote, 0.1);
    await commitStep(h.db, mine.runId, w.step);
    const [src] = await h.db
      .select({ meta: sources.meta })
      .from(sources)
      .where(eq(sources.id, theirSource));
    expect(src?.meta).not.toHaveProperty("hijacked");
    const [note] = await h.db
      .select({ coverage: notes.coverage })
      .from(notes)
      .where(eq(notes.id, theirNote));
    expect(note?.coverage).toBe(0.9);
    const client = fakeEmbeddingsClient();
    const other = new NoteWriter({ db: h.db, embedder: createEmbedder(client, testLogger) });
    expect(await other.backfillEmbeddings(mine, theirNote, { step: testWrite(mine).step })).toBe(0);
    expect(client.calls).toEqual([]);
  });

  it("ignores a draft title once the run has its note, and survives bad mediaLost meta", async () => {
    const scope = await seedRun(h.db);
    const secrets: MaskSources = {
      ...NO_MASK_SOURCES,
      hasSecrets: () => true,
      redact: (text) => text.replaceAll("hunter2", "[secret]"),
    };
    const first = testWrite(scope, secrets);
    const noteId = await writer().ensureNote(first, { title: "Account", lede: null });
    writer().stageSource(first, { ...source(noteId), meta: { mediaLost: "lots" } });
    writer().stageQuality(first, noteId, 1);
    await commitStep(h.db, scope.runId, first.step);
    const later = testWrite(scope, secrets);
    await expect(
      writer().ensureNote(later, { title: "Your password is hunter2", lede: null }),
    ).resolves.toBe(noteId);
  });

  it("refuses asset types outside the allow-list and bytes over MAX_ASSET_BYTES (review I6)", async () => {
    const scope = await seedRun(h.db);
    const store = createAssetStore({ db: h.db, storage });
    const input = { width: 1, height: 1, sourceUrl: null };
    await expect(
      store.put(
        scope.workspaceId,
        { ...input, bytes: new TextEncoder().encode("<script>1</script>"), mime: "text/html" },
        NO_MASK_SOURCES,
      ),
    ).rejects.toThrow(/asset type/);
    await expect(
      store.put(
        scope.workspaceId,
        { ...input, bytes: new Uint8Array(MAX_ASSET_BYTES + 1), mime: "image/png" },
        NO_MASK_SOURCES,
      ),
    ).rejects.toThrow(/too large/);
  });

  it("stores blocks without vectors when embeddings fail, then backfills", async () => {
    const scope = await seedRun(h.db);
    const w = testWrite(scope);
    const failing = writer(true);
    const noteId = await failing.ensureNote(w, { title: "N", lede: null });
    await failing.appendBlocks(w, {
      noteId,
      sourceId: null,
      afterBlockId: null,
      blocks: [block("Leaf")],
    });
    await commitStep(h.db, scope.runId, w.step);
    const step = testWrite(scope).step;
    expect(await writer().backfillEmbeddings(scope, noteId, { step })).toBe(1);
    expect(await writer().backfillEmbeddings(scope, noteId, { step })).toBe(0);
    expect(step.usage.inputTokens).toBe(1);
  });

  it("stores assets once per workspace (content-addressed)", async () => {
    const scope = await seedRun(h.db);
    const store = createAssetStore({ db: h.db, storage });
    const bytes = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const one = await store.put(
      scope.workspaceId,
      {
        bytes,
        mime: "image/svg+xml",
        width: 1,
        height: 1,
        sourceUrl: null,
      },
      NO_MASK_SOURCES,
    );
    const two = await store.put(
      scope.workspaceId,
      {
        bytes,
        mime: "image/svg+xml",
        width: 1,
        height: 1,
        sourceUrl: null,
      },
      NO_MASK_SOURCES,
    );
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

describe("appendTimedBlocks", () => {
  it("interleaves by time with headings before keyframes before text, across steps and within one", async () => {
    const scope = await seedRun(h.db);
    const notesWriter = writer();
    const t = (type: BlockDraft["type"], markdown: string, at: number) => ({
      type,
      markdown,
      origin: "captions" as const,
      assetId: null,
      verified: true,
      anchor: timeAnchor(at, at + 1),
    });
    const w1 = testWrite(scope);
    const noteId = await notesWriter.ensureNote(w1, { title: "V", lede: null });
    const sourceId = notesWriter.stageSource(w1, {
      ...source(noteId, "https://www.youtube.com/watch?v=a"),
      kind: "youtube",
    });
    await notesWriter.appendTimedBlocks(w1, {
      noteId,
      sourceId,
      blocks: [t("transcript", "t0", 0), t("transcript", "t5", 5), t("transcript", "t10", 10)],
    });
    await notesWriter.appendTimedBlocks(w1, {
      noteId,
      sourceId,
      blocks: [t("heading", "## One", 0)],
    });
    await commitStep(h.db, scope.runId, w1.step);
    const w2 = testWrite(scope);
    await notesWriter.appendTimedBlocks(w2, {
      noteId,
      sourceId,
      blocks: [t("heading", "## Two", 5), t("keyframe", "k6", 6)],
    });
    await commitStep(h.db, scope.runId, w2.step);
    const w3 = testWrite(scope);
    await notesWriter.appendBlocks(w3, {
      noteId,
      sourceId: null,
      afterBlockId: null,
      blocks: [block("after video")],
    });
    await commitStep(h.db, scope.runId, w3.step);
    const w4 = testWrite(scope);
    await notesWriter.appendTimedBlocks(w4, {
      noteId,
      sourceId,
      blocks: [t("keyframe", "k12", 12)],
    });
    await commitStep(h.db, scope.runId, w4.step);
    expect((await ordered(noteId)).map((r) => r.markdown)).toEqual([
      "## One",
      "t0",
      "## Two",
      "t5",
      "k6",
      "t10",
      "k12",
      "after video",
    ]);
  });
});
