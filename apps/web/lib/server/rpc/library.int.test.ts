import { fakeEmbeddingsClient } from "@mastertutor/contracts/testing";
import {
  assets,
  createDb,
  ensureWorkspaceMember,
  folders,
  noteBlocks,
  notes,
  objectDeletions,
  sources,
  type DbHandle,
} from "@mastertutor/db";
import { seedMember, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { createRouterClient } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Viewer } from "../viewer.ts";
import { createLibraryProcedures } from "./library.ts";

const viewer: Viewer = { id: "u-library", name: "L", email: "library@example.test" };
const MISSING = "00000000-0000-4000-8000-00000000dead";

let tdb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let workspaceId: string;

const client = (who: Viewer | null = viewer) =>
  createRouterClient(
    createLibraryProcedures({ db: () => web, embeddings: () => fakeEmbeddingsClient() }),
    { context: { viewer: who } },
  );

/** A note with one verified and one unverified captured block, at byte-ordered positions. */
async function seedNote(
  inWorkspace: string,
  options: {
    title: string;
    coverage?: number | null;
    folderId?: string | null;
    kind?: "web" | "pdf";
    createdAt?: Date;
    mediaLost?: number;
  },
) {
  const [note] = await owner.db
    .insert(notes)
    .values({
      workspaceId: inWorkspace,
      title: options.title,
      coverage: options.coverage === undefined ? 1 : options.coverage,
      folderId: options.folderId ?? null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    })
    .returning({ id: notes.id });
  const noteId = note!.id;
  const [source] = await owner.db
    .insert(sources)
    .values({
      workspaceId: inWorkspace,
      kind: options.kind ?? "web",
      url: "https://example.com/a",
      origin: "https://example.com",
      meta: { noteId, mediaLost: options.mediaLost ?? 0 },
    })
    .returning({ id: sources.id });
  const blocks = await owner.db
    .insert(noteBlocks)
    .values([
      {
        noteId,
        position: "a1",
        type: "paragraph",
        markdown: "Second",
        origin: "dom",
        sourceId: source!.id,
        verified: true,
      },
      {
        noteId,
        position: "Z0",
        type: "paragraph",
        markdown: "First",
        origin: "dom",
        sourceId: source!.id,
        verified: false,
      },
    ])
    .returning({ id: noteBlocks.id, position: noteBlocks.position });
  return {
    noteId,
    unverified: blocks.find((b) => b.position === "Z0")!.id,
    verified: blocks.find((b) => b.position === "a1")!.id,
  };
}

beforeAll(async () => {
  tdb = await startTestDatabase();
  owner = createDb(tdb.ownerUrl, { max: 2 });
  web = createDb(tdb.webUrl, { max: 4 });
  await owner.sql`insert into "user" (id, name, email) values (${viewer.id}, ${viewer.name}, ${viewer.email})`;
  ({ workspaceId } = await ensureWorkspaceMember(web.db, viewer.id));
});
afterAll(async () => {
  await Promise.all([web?.close(), owner?.close()]);
  await tdb?.stop();
});

describe("library binding on the live router (Task 0C)", () => {
  it("requires a session and a workspace, and maps service error codes 1:1", async () => {
    await expect(client(null).folders.tree({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await owner.sql`insert into "user" (id, name, email) values ('u-lib-none', 'N', 'lib-none@example.test')`;
    await expect(
      client({ id: "u-lib-none", name: "N", email: "lib-none@example.test" }).folders.tree({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    let parent: string | null = null;
    for (let depth = 0; depth < 8; depth++)
      parent = (await client().folders.create({ name: `Depth ${depth}`, parentId: parent })).id;
    await expect(
      client().folders.create({ name: "Ninth", parentId: parent }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(client().folders.create({ name: "Depth 0" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(client().assets.url({ assetId: MISSING })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(client().notes.export({ noteId: MISSING })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lists notes newest first by folder and kind, with source kinds and a keyset cursor", async () => {
    const member = await seedMember(owner.db);
    const who = { id: member.userId, name: "M", email: `${member.userId}@example.test` };
    const [folder] = await owner.db
      .insert(folders)
      .values({ workspaceId: member.workspaceId, name: "Biology" })
      .returning({ id: folders.id });
    const older = await seedNote(member.workspaceId, {
      title: "Older",
      createdAt: new Date("2026-10-01T00:00:00Z"),
      kind: "pdf",
    });
    const newer = await seedNote(member.workspaceId, {
      title: "Newer",
      createdAt: new Date("2026-10-02T00:00:00Z"),
      folderId: folder!.id,
    });
    const page = await client(who).notes.list({ limit: 1 });
    expect(page.items.map((n) => n.id)).toEqual([newer.noteId]);
    expect(page.items[0]!.sourceKinds).toEqual(["web"]);
    const next = await client(who).notes.list({ limit: 1, cursor: page.nextCursor });
    expect(next.items.map((n) => n.id)).toEqual([older.noteId]);
    expect((await client(who).notes.list({ folder: "unfiled" })).items.map((n) => n.id)).toEqual([
      older.noteId,
    ]);
    expect((await client(who).notes.list({ folder: folder!.id })).items.map((n) => n.id)).toEqual([
      newer.noteId,
    ]);
    expect((await client(who).notes.list({ kind: "pdf" })).items.map((n) => n.id)).toEqual([
      older.noteId,
    ]);
    await expect(client(who).notes.list({ cursor: "1" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await client().notes.list({})).items.some((n) => n.id === newer.noteId)).toBe(false);
  });

  it("gets a note with blocks in byte order, and hides other workspaces' notes and blocks", async () => {
    const mine = await seedNote(workspaceId, { title: "Mine" });
    const detail = await client().notes.get({ noteId: mine.noteId });
    expect(detail.blocks.map((b) => b.markdown)).toEqual(["First", "Second"]);
    expect(detail.sources).toHaveLength(1);
    const stranger = await seedMember(owner.db);
    const theirs = await seedNote(stranger.workspaceId, { title: "Theirs" });
    await expect(client().notes.get({ noteId: theirs.noteId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      client().notes.updateBlock({ blockId: theirs.unverified, markdown: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client().notes.markVerified({ blockId: theirs.unverified })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    await expect(client().notes.delete({ noteId: theirs.noteId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("edits a block, keeping the captured original across edits and dropping its stale vector", async () => {
    const note = await seedNote(workspaceId, { title: "Edit me" });
    const first = await client().notes.updateBlock({
      blockId: note.unverified,
      markdown: "First, edited",
    });
    expect(first).toMatchObject({
      markdown: "First, edited",
      edited: true,
      originalMarkdown: "First",
    });
    const second = await client().notes.updateBlock({
      blockId: note.unverified,
      markdown: "Again",
    });
    expect(second).toMatchObject({ markdown: "Again", originalMarkdown: "First" });
    const [row] = await owner.db
      .select({ embedding: noteBlocks.embedding })
      .from(noteBlocks)
      .where(eq(noteBlocks.id, note.unverified));
    expect(row!.embedding).toBeNull();
  });

  it("marks a block verified and recomputes fidelity with the shared rule", async () => {
    const full = await seedNote(workspaceId, { title: "Full", coverage: 1 });
    await owner.db.update(notes).set({ fidelity: "needs_review" }).where(eq(notes.id, full.noteId));
    expect((await client().notes.markVerified({ blockId: full.unverified })).verified).toBe(true);
    expect((await client().notes.get({ noteId: full.noteId })).note.fidelity).toBe("verified");
    const thin = await seedNote(workspaceId, { title: "Thin", coverage: 0.5 });
    await client().notes.markVerified({ blockId: thin.unverified });
    expect((await client().notes.get({ noteId: thin.noteId })).note.fidelity).toBe("partial");
    const lost = await seedNote(workspaceId, { title: "Lost media", coverage: 1, mediaLost: 1 });
    await client().notes.markVerified({ blockId: lost.unverified });
    expect((await client().notes.get({ noteId: lost.noteId })).note.fidelity).toBe("partial");
  });

  it("deletes a note, moves one, exports one and searches", async () => {
    const note = await seedNote(workspaceId, { title: "Photosynthesis" });
    const folder = await client().folders.create({ name: "Plants" });
    await client().notes.move({ noteId: note.noteId, folderId: folder.id });
    expect((await client().notes.get({ noteId: note.noteId })).note).toMatchObject({
      folderId: folder.id,
      filedBy: "user",
    });
    expect((await client().notes.export({ noteId: note.noteId })).downloadUrl).toBe(
      `/api/notes/${note.noteId}/export`,
    );
    // Two matching blocks in one note: the search still answers one hit for that note.
    await owner.db.insert(noteBlocks).values([
      {
        noteId: note.noteId,
        position: "b0",
        type: "paragraph",
        markdown: "Photosynthesis makes sugar",
        origin: "dom",
        verified: true,
      },
      {
        noteId: note.noteId,
        position: "b1",
        type: "paragraph",
        markdown: "Photosynthesis needs light",
        origin: "dom",
        verified: true,
      },
    ]);
    const { items } = await client().notes.search({ q: "Photosynthesis" });
    expect(items.filter((i) => i.noteId === note.noteId)).toHaveLength(1);
    await expect(client().notes.delete({ noteId: note.noteId })).resolves.toEqual({ ok: true });
    await expect(client().notes.get({ noteId: note.noteId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("edits and marks verified the same block at once without a deadlock (one lock order)", async () => {
    for (let round = 0; round < 25; round++) {
      const note = await seedNote(workspaceId, { title: `Race ${round}` });
      const results = await Promise.allSettled([
        client().notes.updateBlock({ blockId: note.unverified, markdown: `Edited ${round}` }),
        client().notes.markVerified({ blockId: note.unverified }),
        client().notes.updateBlock({ blockId: note.verified, markdown: `Other ${round}` }),
        client().notes.markVerified({ blockId: note.verified }),
      ]);
      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    }
  });

  it("deleting a note removes its sources and the assets only it used, and queues their objects", async () => {
    const note = await seedNote(workspaceId, { title: "With media" });
    const other = await seedNote(workspaceId, { title: "Shares one image" });
    const asset = async (sha: string) =>
      (
        await owner.db
          .insert(assets)
          .values({
            workspaceId,
            sha256: sha,
            bucket: "b",
            key: `assets/${workspaceId}/${sha}`,
            mime: "image/png",
            bytes: 1,
          })
          .returning({ id: assets.id, key: assets.key })
      )[0]!;
    const own = await asset("1".repeat(64));
    const inline = await asset("2".repeat(64));
    const shared = await asset("3".repeat(64));
    await owner.db.insert(noteBlocks).values([
      {
        noteId: note.noteId,
        position: "c0",
        type: "image",
        markdown: "Own",
        origin: "dom",
        assetId: own.id,
        verified: true,
      },
      {
        noteId: note.noteId,
        position: "c1",
        type: "paragraph",
        markdown: `See ![x](asset:${inline.id})`,
        origin: "dom",
        verified: true,
      },
      {
        noteId: note.noteId,
        position: "c2",
        type: "image",
        markdown: "Shared",
        origin: "dom",
        assetId: shared.id,
        verified: true,
      },
      {
        noteId: other.noteId,
        position: "c0",
        type: "paragraph",
        markdown: `Also ![y](asset:${shared.id})`,
        origin: "dom",
        verified: true,
      },
    ]);
    await owner.db
      .update(sources)
      .set({ mhtmlKey: `snapshots/${note.noteId}/page.mhtml` })
      .where(sql`${sources.meta}->>'noteId' = ${note.noteId}`);
    await client().notes.delete({ noteId: note.noteId });
    expect(
      await owner.db.select().from(noteBlocks).where(eq(noteBlocks.noteId, note.noteId)),
    ).toEqual([]);
    expect(
      await owner.db
        .select()
        .from(sources)
        .where(sql`${sources.meta}->>'noteId' = ${note.noteId}`),
    ).toEqual([]);
    const left = (await owner.db.select({ id: assets.id }).from(assets)).map((a) => a.id);
    expect(left).not.toContain(own.id);
    expect(left).not.toContain(inline.id);
    expect(left).toContain(shared.id);
    const queued = (await owner.db.select({ key: objectDeletions.key }).from(objectDeletions)).map(
      (r) => r.key,
    );
    expect(queued).toEqual(
      expect.arrayContaining([own.key, inline.key, `snapshots/${note.noteId}/page.mhtml`]),
    );
    expect(queued).not.toContain(shared.key);
  });
});
