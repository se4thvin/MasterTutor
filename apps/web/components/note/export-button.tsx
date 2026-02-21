"use client";

import type { NoteDetail } from "@mastertutor/contracts";
import { useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api } from "@/lib/api/client.ts";
import { safeDownloadUrl } from "@/lib/export/download-url.ts";
import { exportFileName } from "@/lib/export/note-markdown.ts";

export function ExportButton({ detail }: { detail: NoteDetail }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const { downloadUrl } = await api.notes.export({ noteId: detail.note.id });
      const href = safeDownloadUrl(downloadUrl);
      if (!href) throw new Error("unsafe download URL");
      const a = document.createElement("a");
      a.href = href;
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
      // The name always contains the visible text (WCAG 2.5.3); compact widths show the icon only.
      aria-label="Export .md"
    >
      <span className="hidden md:inline">Export .md</span>
    </Button>
  );
}
