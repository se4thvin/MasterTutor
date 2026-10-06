"use client";

import type { FolderView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";

/** Optimistic folder reparenting shared by drag and drop and the "Move folder to…" sheet. */
export function useMoveFolder() {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (folderId: string, parentId: string | null) => {
      const key = orpc.folders.tree.queryKey({ input: {} });
      const previous = qc.getQueryData<{ folders: FolderView[] }>(key);
      if (previous?.folders.find((f) => f.id === folderId)?.parentId === parentId) return;
      qc.setQueryData<{ folders: FolderView[] }>(key, (old) =>
        old
          ? { folders: old.folders.map((f) => (f.id === folderId ? { ...f, parentId } : f)) }
          : old,
      );
      try {
        await api.folders.move({ folderId, parentId });
      } catch {
        qc.setQueryData(key, previous);
        toast({
          title: "Couldn't move the folder.",
          description: "Nothing changed.",
          icon: "needsReview",
          tone: "danger",
        });
      } finally {
        await qc.invalidateQueries({ queryKey: key });
      }
    },
    [qc, toast],
  );
}
