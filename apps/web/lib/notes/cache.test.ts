import type { NoteDetail, NoteSummary } from "@mastertutor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { orpc } from "@/lib/api/client.ts";
import { cancelNoteQueries, deleteNoteOptimistically } from "./cache.ts";
import { applyNoteFolder } from "./move-cache.ts";

const NOTE = "00000000-0000-4000-8000-000002000001";
const OTHER = "00000000-0000-4000-8000-000002000002";
const FOLDER = "00000000-0000-4000-8000-000001000004";

const summary = (id: string) =>
  ({ id, folderId: null, filedBy: "agent", title: id }) as unknown as NoteSummary;
const detail = (id: string) =>
  ({ note: summary(id), blocks: [], sources: [] }) as unknown as NoteDetail;
const hit = (noteId: string) => ({ noteId, blockId: null, title: noteId, snippet: "", score: 1 });

const getKey = (id: string) => orpc.notes.get.queryKey({ input: { noteId: id } });
const searchKey = orpc.notes.search.queryKey({ input: { q: "warmup", kind: null, limit: 20 } });
const listKey = orpc.notes.list.queryKey({
  input: { folder: "all", kind: null, limit: 50, cursor: null },
});

/** A query whose response is still on the wire until `release()`: it was answered before the write. */
function inFlight<T>(qc: QueryClient, key: readonly unknown[], data: T) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const done = qc
    .fetchQuery({ queryKey: key, queryFn: async () => (await gate, data), staleTime: 0 })
    .catch(() => undefined);
  return { release, done };
}

describe("deleting a note (R29-6)", () => {
  it("drops its detail and search hits, even when their responses land after the delete", async () => {
    const qc = new QueryClient();
    qc.setQueryData(listKey, { items: [summary(NOTE), summary(OTHER)], nextCursor: null });
    qc.setQueryData(searchKey, { items: [hit(NOTE), hit(OTHER)] });
    const lateGet = inFlight(qc, getKey(NOTE), detail(NOTE));
    const lateSearch = inFlight(qc, searchKey, { items: [hit(NOTE), hit(OTHER)] });

    const ok = await deleteNoteOptimistically(qc, NOTE, async () => ({ ok: true }));
    lateGet.release();
    lateSearch.release();
    await Promise.all([lateGet.done, lateSearch.done]);

    expect(ok).toBe(true);
    expect(qc.getQueryData(getKey(NOTE))).toBeUndefined();
    const search = qc.getQueryData<{ items: Array<{ noteId: string }> }>(searchKey);
    expect(search?.items.map((h) => h.noteId)).toEqual([OTHER]);
    expect(qc.getQueryState(searchKey)?.isInvalidated).toBe(true);
    const list = qc.getQueryData<{ items: NoteSummary[] }>(listKey);
    expect(list?.items.map((n) => n.id)).toEqual([OTHER]);
  });

  it("restores the lists but nothing else when the delete fails", async () => {
    const qc = new QueryClient();
    qc.setQueryData(listKey, { items: [summary(NOTE), summary(OTHER)], nextCursor: null });
    qc.setQueryData(getKey(NOTE), detail(NOTE));
    const ok = await deleteNoteOptimistically(qc, NOTE, async () => {
      throw new Error("500");
    });
    expect(ok).toBe(false);
    expect(qc.getQueryData<{ items: NoteSummary[] }>(listKey)?.items).toHaveLength(2);
    expect(qc.getQueryData(getKey(NOTE))).toBeDefined();
  });
});

describe("moving a note (M10)", () => {
  it("a list refetch already in flight cannot undo the optimistic move", async () => {
    const qc = new QueryClient();
    qc.setQueryData(listKey, { items: [summary(NOTE)], nextCursor: null });
    const stale = inFlight(qc, listKey, { items: [summary(NOTE)], nextCursor: null });
    await cancelNoteQueries(qc, NOTE);
    applyNoteFolder(qc, NOTE, FOLDER);
    stale.release();
    await stale.done;
    const list = qc.getQueryData<{ items: NoteSummary[] }>(listKey);
    expect(list?.items[0]?.folderId).toBe(FOLDER);
  });
});
