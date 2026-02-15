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
