"use client";

import type { NoteDetail } from "@mastertutor/contracts";
import { useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api } from "@/lib/api/client.ts";
import { exportFileName } from "@/lib/export/note-markdown.ts";

export function ExportButton({ detail }: { detail: NoteDetail }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const { downloadUrl } = await api.notes.export({ noteId: detail.note.id });
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = exportFileName(detail.note.title);
      a.click();
    } catch {
      toast({ title: "Couldn't export the note.", icon: "needsReview", tone: "danger" });
    } finally {
      setPending(false);
    }
  };
  return (
    <Button
      icon="export"
      onClick={() => void run()}
      disabled={pending}
      aria-label="Export as Markdown"
    >
      <span className="hidden md:inline">Export .md</span>
    </Button>
  );
}
