import { EMBEDDING_DIMENSIONS } from "@mastertutor/contracts";
import { hashEmbedding } from "@mastertutor/contracts/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { noteBlocks, notes, sources, workspaces } from "../schema/index.ts";
import { startTestDatabase, type TestDatabase } from "../testing.ts";
import { hybridSearch } from "./search.ts";

let tdb: TestDatabase;
let h: DbHandle;
let ws: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1"] });
  h = createDb(tdb.webUrl);
  const owner = createDb(tdb.ownerUrl);
  [{ id: ws }] = (await owner.db
    .insert(workspaces)
    .values({ name: "W" })
    .returning({ id: workspaces.id })) as [{ id: string }];
  const [other] = await owner.db
    .insert(workspaces)
    .values({ name: "Other" })
    .returning({ id: workspaces.id });
  const [pdf] = await owner.db
    .insert(sources)
    .values({ workspaceId: ws, kind: "pdf", url: "https://x.test/a.pdf", origin: "https://x.test" })
    .returning({ id: sources.id });
  const add = async (
    name: string,
    workspaceId: string,
    title: string,
    markdown: string,
    sourceId: string | null = null,
  ) => {
    const [note] = await owner.db
      .insert(notes)
      .values({ workspaceId, title })
      .returning({ id: notes.id });
    const [block] = await owner.db
      .insert(noteBlocks)
      .values({
        noteId: note!.id,
        position: "a0",
        type: "paragraph",
        markdown,
        origin: "dom",
        sourceId,
        embedding: hashEmbedding(markdown),
      })
      .returning({ id: noteBlocks.id });
    ids[name] = note!.id;
    ids[`${name}:block`] = block!.id;
  };
  await add(
    "lexical",
    ws,
    "Cell energy",
    "Mitochondria produce ATP through oxidative phosphorylation.",
  );
  await add("vector", ws, "Untitled", "powerhouse organelle energy currency");
  await add("title", ws, "Mitochondria and ATP overview", "Nothing relevant in this block.");
  await add("pdf", ws, "Paper", "Mitochondria in muscle cells.", pdf!.id);
  await add("foreign", other!.id, "Mitochondria elsewhere", "Mitochondria produce ATP.");
  await owner.close();
});
afterAll(async () => {
  await h?.close();
  await tdb?.stop();
});

describe("hybridSearch", () => {
  it("fuses block text, title and vector hits, one per note, workspace-scoped", async () => {
    const hits = await hybridSearch(h.db, {
      workspaceId: ws,
      q: "mitochondria ATP",
      embedding: hashEmbedding("mitochondria ATP energy"),
      kind: null,
      limit: 10,
    });
    const noteIds = hits.map((hit) => hit.noteId);
    expect(noteIds[0]).toBe(ids.lexical);
    expect(noteIds).toEqual(expect.arrayContaining([ids.title, ids.pdf, ids.vector]));
    expect(noteIds).not.toContain(ids.foreign);
    expect(new Set(noteIds).size).toBe(noteIds.length);
    expect(hits[0]).toMatchObject({
      blockId: ids["lexical:block"],
      snippet: expect.stringContaining("Mitochondria"),
    });
    expect(hits.find((hit) => hit.noteId === ids.title)?.blockId).toBeNull();
  });
  it("filters by source kind and survives tsquery syntax", async () => {
    const pdfOnly = await hybridSearch(h.db, {
      workspaceId: ws,
      q: "mitochondria",
      embedding: null,
      kind: "pdf",
      limit: 10,
    });
    expect(pdfOnly.map((hit) => hit.noteId)).toEqual([ids.pdf]);
    for (const q of ["a & | ! : * ( )", '"unterminated', "the of and"]) {
      await expect(
        hybridSearch(h.db, { workspaceId: ws, q, embedding: null, kind: null, limit: 5 }),
      ).resolves.toBeInstanceOf(Array);
    }
  });
  it("keeps only vector neighbours above the similarity floor (hand-built vectors)", async () => {
    const owner = createDb(tdb.ownerUrl);
    const axis = (i: number) =>
      Array.from({ length: EMBEDDING_DIMENSIONS }, (_, k) => (k === i ? 1 : 0));
    const seed = async (title: string, embedding: number[]) => {
      const [note] = await owner.db
        .insert(notes)
        .values({ workspaceId: ws, title })
        .returning({ id: notes.id });
      await owner.db.insert(noteBlocks).values({
        noteId: note!.id,
        position: "a0",
        type: "paragraph",
        markdown: "zzqx",
        origin: "dom",
        embedding,
      });
      return note!.id;
    };
    const near = await seed("Near", axis(1));
    const orthogonal = await seed("Orthogonal", axis(2));
    await owner.close();
    const hits = await hybridSearch(h.db, {
      workspaceId: ws,
      q: "qqqnomatch",
      embedding: axis(1),
      kind: null,
      limit: 10,
    });
    expect(hits.map((hit) => hit.noteId)).toEqual([near]);
    expect(hits.map((hit) => hit.noteId)).not.toContain(orthogonal);
  });
});
