import { Uuid } from "@mastertutor/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NoteReader } from "@/components/note/note-reader.tsx";

export const metadata: Metadata = { title: "Note" };

export default async function NotePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  if (!Uuid.safeParse(noteId).success) notFound();
  return (
    <Suspense>
      <NoteReader noteId={noteId} />
    </Suspense>
  );
}
