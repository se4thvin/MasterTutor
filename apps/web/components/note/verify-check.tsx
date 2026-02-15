"use client";

import type { NoteBlock, NoteDetail } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { SpringCheck } from "@/components/bits/spring-check.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { patchNoteDetail } from "@/lib/notes/cache.ts";

/** Same rule the server applies: a needs-review note is promoted once every block is verified. */
function withVerified(detail: NoteDetail, blockId: string): NoteDetail {
  const blocks = detail.blocks.map((b) => (b.id === blockId ? { ...b, verified: true } : b));
  const allVerified = blocks.every((b) => b.verified);
  const fidelity =
    detail.note.fidelity === "needs_review" && allVerified
      ? (detail.note.coverage ?? 1) >= 0.98
        ? "verified"
        : "partial"
      : detail.note.fidelity;
  return { ...detail, blocks, note: { ...detail.note, fidelity } };
}

export function VerifyCheck({ block }: { block: NoteBlock }) {
  const qc = useQueryClient();
  const toast = useToast();
  const verify = async () => {
    const previous = patchNoteDetail(qc, block.noteId, (d) => withVerified(d, block.id));
    try {
      await api.notes.markVerified({ blockId: block.id });
      toast({ title: "Marked verified", icon: "verified" });
    } catch {
      if (previous) {
        qc.setQueryData(orpc.notes.get.queryKey({ input: { noteId: block.noteId } }), previous);
      }
      toast({
        title: "Couldn't mark the block verified.",
        description: "It still needs review.",
        icon: "needsReview",
        tone: "danger",
      });
    } finally {
      // The note's fidelity shows in lists too; refetch rather than patch every page.
      await qc.invalidateQueries({ queryKey: orpc.notes.list.key() });
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
