import type { NoteDetail, NoteSummary } from "@mastertutor/contracts";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api/client.ts";

export interface NotesPage {
  items: NoteSummary[];
  nextCursor: string | null;
}

/** Applies fn to every cached notes.list result, whether paged (useInfiniteQuery) or single (useQuery). */
export function patchNoteLists(qc: QueryClient, fn: (items: NoteSummary[]) => NoteSummary[]): void {
  qc.setQueriesData<InfiniteData<NotesPage> | NotesPage>(
    { queryKey: orpc.notes.list.key() },
    (data) => {
      if (!data) return data;
      if ("pages" in data) {
        return { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items) })) };
      }
      return { ...data, items: fn(data.items) };
    },
  );
}

export function patchNoteDetail(
  qc: QueryClient,
  noteId: string,
  fn: (detail: NoteDetail) => NoteDetail,
): NoteDetail | undefined {
  const key = orpc.notes.get.queryKey({ input: { noteId } });
  const previous = qc.getQueryData<NoteDetail>(key);
  if (previous) qc.setQueryData<NoteDetail>(key, fn(previous));
  return previous;
}

interface SearchResult {
  items: Array<{ noteId: string }>;
}

/**
 * Stops every in-flight read that could carry this note's old state (lists, its detail, search),
 * so a response answered before a write cannot land on top of the write's optimistic result.
 */
export async function cancelNoteQueries(qc: QueryClient, noteId: string): Promise<void> {
  await Promise.all([
    qc.cancelQueries({ queryKey: orpc.notes.list.key() }),
    qc.cancelQueries({ queryKey: orpc.notes.get.queryKey({ input: { noteId } }), exact: true }),
    qc.cancelQueries({ queryKey: orpc.notes.search.key() }),
  ]);
}

/**
 * Deletes a note optimistically: it leaves the lists at once and, on success, its detail and
 * search hits are dropped too (a stale detail or hit would reopen a deleted note). On failure
 * only the lists are restored; the detail and search were merely cancelled. Returns whether the
 * server deleted it. Lists are refetched either way.
 */
export async function deleteNoteOptimistically(
  qc: QueryClient,
  noteId: string,
  send: () => Promise<unknown>,
): Promise<boolean> {
  await cancelNoteQueries(qc, noteId);
  const lists = qc.getQueriesData({ queryKey: orpc.notes.list.key() });
  patchNoteLists(qc, (items) => items.filter((n) => n.id !== noteId));
  try {
    await send();
    qc.removeQueries({
      queryKey: orpc.notes.get.queryKey({ input: { noteId } }),
      exact: true,
    });
    qc.setQueriesData<SearchResult>(
      { queryKey: orpc.notes.search.key() },
      (data) => data && { ...data, items: data.items.filter((h) => h.noteId !== noteId) },
    );
    void qc.invalidateQueries({ queryKey: orpc.notes.search.key() });
    return true;
  } catch {
    for (const [key, data] of lists) qc.setQueryData(key, data);
    return false;
  } finally {
    void qc.invalidateQueries({ queryKey: orpc.notes.list.key() });
  }
}
