"use client";

import type { NoteSummary } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { patchNoteLists } from "@/lib/notes/cache.ts";

export function useDeleteNote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (note: NoteSummary) => {
      const snapshot = qc.getQueriesData({ queryKey: orpc.notes.list.key() });
      patchNoteLists(qc, (items) => items.filter((n) => n.id !== note.id));
      try {
        await api.notes.delete({ noteId: note.id });
        toast({ title: "Note deleted", icon: "delete" });
      } catch {
        for (const [key, data] of snapshot) qc.setQueryData(key, data);
        toast({ title: "Couldn't delete the note.", icon: "needsReview", tone: "danger" });
      } finally {
        await qc.invalidateQueries({ queryKey: orpc.notes.list.key() });
      }
    },
    [qc, toast],
  );
}
