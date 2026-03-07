import type { NoteDetail } from "@mastertutor/contracts";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { orpc } from "@/lib/api/client.ts";
import { patchNoteDetail, patchNoteLists } from "./cache.ts";

interface NoteCacheSnapshot {
  lists: Array<[QueryKey, unknown]>;
  detail: NoteDetail | undefined;
}

/** Everything a move touches, captured before the optimistic write. */
export function snapshotNote(qc: QueryClient, noteId: string): NoteCacheSnapshot {
  return {
    lists: qc.getQueriesData({ queryKey: orpc.notes.list.key() }),
    detail: qc.getQueryData<NoteDetail>(orpc.notes.get.queryKey({ input: { noteId } })),
  };
}

export function applyNoteFolder(qc: QueryClient, noteId: string, folderId: string | null): void {
  patchNoteLists(qc, (items) =>
    items.map((n) => (n.id === noteId ? { ...n, folderId, filedBy: "user" } : n)),
  );
  patchNoteDetail(qc, noteId, (d) => ({ ...d, note: { ...d.note, folderId, filedBy: "user" } }));
}

/** Puts back exactly what the snapshot held (folderId and filedBy included). */
export function restoreNote(qc: QueryClient, noteId: string, snapshot: NoteCacheSnapshot): void {
  for (const [key, data] of snapshot.lists) qc.setQueryData(key, data);
  if (snapshot.detail) {
    qc.setQueryData(orpc.notes.get.queryKey({ input: { noteId } }), snapshot.detail);
  }
}
