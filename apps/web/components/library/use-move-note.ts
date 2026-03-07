"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { cancelNoteQueries } from "@/lib/notes/cache.ts";
import { applyNoteFolder, restoreNote, snapshotNote } from "@/lib/notes/move-cache.ts";

/** Optimistic move with an Undo toast. Undo is itself a move, so it never offers Undo again. */
export function useMoveNote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async function move(
      noteId: string,
      to: string | null,
      from: string | null,
      options: { undo?: boolean } = {},
    ): Promise<void> {
      if (to === from) return;
      // A read answered before the move must not land on top of the optimistic result.
      await cancelNoteQueries(qc, noteId);
      const snapshot = snapshotNote(qc, noteId);
      applyNoteFolder(qc, noteId, to);
      try {
        await api.notes.move({ noteId, folderId: to });
        if (!options.undo) {
          const folders =
            qc.getQueryData<{ folders: Array<{ id: string; name: string }> }>(
              orpc.folders.tree.queryKey({ input: {} }),
            )?.folders ?? [];
          const name =
            to === null ? "Unfiled" : (folders.find((f) => f.id === to)?.name ?? "folder");
          toast({
            title: `Moved to ${name}`,
            icon: "move",
            actionLabel: "Undo",
            onAction: () => void move(noteId, from, to, { undo: true }),
          });
        }
      } catch {
        restoreNote(qc, noteId, snapshot);
        toast({
          title: "Couldn't move the note.",
          description: "Nothing changed.",
          icon: "needsReview",
          tone: "danger",
        });
      } finally {
        await Promise.all([
          qc.invalidateQueries({ queryKey: orpc.notes.list.key() }),
          qc.invalidateQueries({ queryKey: orpc.notes.get.key() }),
        ]);
      }
    },
    [qc, toast],
  );
}
