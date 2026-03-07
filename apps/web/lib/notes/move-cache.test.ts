import type { NoteDetail, NoteSummary } from "@mastertutor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { orpc } from "@/lib/api/client.ts";
import { applyNoteFolder, restoreNote, snapshotNote } from "./move-cache.ts";

const NOTE_ID = "00000000-0000-4000-8000-000002000001";
const OTHER_ID = "00000000-0000-4000-8000-000002000002";
const FROM = "00000000-0000-4000-8000-000001000002";
const TO = "00000000-0000-4000-8000-000001000004";

const summary = (id: string): NoteSummary =>
  ({ id, folderId: FROM, filedBy: "agent", title: id }) as unknown as NoteSummary;
const detail = (): NoteDetail =>
  ({ note: summary(NOTE_ID), blocks: [], sources: [] }) as unknown as NoteDetail;

function seeded() {
  const qc = new QueryClient();
  const all = orpc.notes.list.queryKey({
    input: { folder: "all", kind: null, limit: 50, cursor: null },
  });
  const scoped = orpc.notes.list.queryKey({
    input: { folder: FROM, kind: null, limit: 50, cursor: null },
  });
  // useInfiniteQuery stores {pages, pageParams} under the same key family.
  qc.setQueryData(all as readonly unknown[], {
    pages: [{ items: [summary(NOTE_ID), summary(OTHER_ID)], nextCursor: null }],
    pageParams: [null],
  });
  qc.setQueryData(scoped, { items: [summary(NOTE_ID)], nextCursor: null });
  qc.setQueryData(orpc.notes.get.queryKey({ input: { noteId: NOTE_ID } }), detail());
  return qc;
}

const dump = (qc: QueryClient) => ({
  lists: qc.getQueriesData({ queryKey: orpc.notes.list.key() }),
  detail: qc.getQueryData(orpc.notes.get.queryKey({ input: { noteId: NOTE_ID } })),
});

describe("move cache", () => {
  it("applies the move to every list and the detail, marking it user-filed", () => {
    const qc = seeded();
    applyNoteFolder(qc, NOTE_ID, TO);
    const { detail: d } = dump(qc);
    expect((d as NoteDetail).note).toMatchObject({ folderId: TO, filedBy: "user" });
    const scoped = qc.getQueryData(
      orpc.notes.list.queryKey({ input: { folder: FROM, kind: null, limit: 50, cursor: null } }),
    ) as { items: NoteSummary[] };
    expect(scoped.items[0]).toMatchObject({ folderId: TO, filedBy: "user" });
  });

  it("restores every cache exactly, including the original filedBy", () => {
    const qc = seeded();
    const before = dump(qc);
    const snapshot = snapshotNote(qc, NOTE_ID);
    applyNoteFolder(qc, NOTE_ID, TO);
    expect(dump(qc)).not.toEqual(before);
    restoreNote(qc, NOTE_ID, snapshot);
    expect(dump(qc)).toEqual(before);
    expect((dump(qc).detail as NoteDetail).note.filedBy).toBe("agent");
  });

  it("restores nothing for a detail that was never cached", () => {
    const qc = seeded();
    qc.removeQueries({ queryKey: orpc.notes.get.queryKey({ input: { noteId: NOTE_ID } }) });
    const snapshot = snapshotNote(qc, NOTE_ID);
    applyNoteFolder(qc, NOTE_ID, TO);
    restoreNote(qc, NOTE_ID, snapshot);
    expect(dump(qc).detail).toBeUndefined();
  });
});
