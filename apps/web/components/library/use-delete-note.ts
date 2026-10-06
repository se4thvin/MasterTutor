"use client";

import type { NoteSummary } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api } from "@/lib/api/client.ts";
import { deleteNoteOptimistically } from "@/lib/notes/cache.ts";

export function useDeleteNote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (note: NoteSummary) => {
      const deleted = await deleteNoteOptimistically(qc, note.id, () =>
        api.notes.delete({ noteId: note.id }),
      );
      toast(
        deleted
          ? { title: "Note deleted", icon: "delete" }
          : { title: "Couldn't delete the note.", icon: "needsReview", tone: "danger" },
      );
    },
    [qc, toast],
  );
}
