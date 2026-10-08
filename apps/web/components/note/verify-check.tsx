"use client";

import type { NoteBlock } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { SpringCheck } from "@/components/bits/spring-check.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { patchNoteDetail } from "@/lib/notes/cache.ts";

export function VerifyCheck({ block }: { block: NoteBlock }) {
  const qc = useQueryClient();
  const toast = useToast();
  const verify = async () => {
    // A refetch in flight would land on top of the optimistic state and un-check the box.
    await qc.cancelQueries({
      queryKey: orpc.notes.get.queryKey({ input: { noteId: block.noteId } }),
    });
    // Optimistic for the check only: the note's fidelity is the server's rule (noteFidelity),
    // never recomputed here, and arrives with the answer.
    const setVerified = (verified: boolean) =>
      patchNoteDetail(qc, block.noteId, (d) => ({
        ...d,
        blocks: d.blocks.map((b) => (b.id === block.id ? { ...b, verified } : b)),
      }));
    setVerified(true);
    try {
      const { fidelity } = await api.notes.markVerified({ blockId: block.id });
      patchNoteDetail(qc, block.noteId, (d) => ({ ...d, note: { ...d.note, fidelity } }));
      toast({ title: "Marked verified", icon: "verified" });
    } catch {
      // Undo only this block, so concurrent changes survive.
      setVerified(block.verified);
      toast({
        title: "Couldn't mark the block verified.",
        description: "It still needs review.",
        icon: "needsReview",
        tone: "danger",
      });
    } finally {
      // The note page and the lists refetch, so every view settles on the server's state.
      await Promise.all([
        qc.invalidateQueries({
          queryKey: orpc.notes.get.queryKey({ input: { noteId: block.noteId } }),
        }),
        qc.invalidateQueries({ queryKey: orpc.notes.list.key() }),
      ]);
    }
  };
  return (
    <SpringCheck
      label="Mark verified"
      doneLabel="Verified"
      checked={block.verified}
      disabled={block.verified}
      onCheckedChange={(next) => next && void verify()}
    />
  );
}
