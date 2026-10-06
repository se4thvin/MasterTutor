"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { folderPath } from "@/lib/folders/tree.ts";
import { libraryHref } from "@/lib/library/params.ts";
import { formatDate } from "@/lib/notes/format.ts";
import { MEDIA } from "@/lib/breakpoints.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { BlockView } from "./block-view.tsx";
import { MarginCallouts } from "./margin-callouts.tsx";
import { SourceStrip } from "./source-strip.tsx";

export function NoteReader({ noteId }: { noteId: string }) {
  const { data, isPending, isError } = useQuery(orpc.notes.get.queryOptions({ input: { noteId } }));
  const folders = useQuery(orpc.folders.tree.queryOptions({ input: {} })).data?.folders ?? [];
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const wide = useMediaQuery(MEDIA.lg);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data || !window.location.hash.startsWith("#block-")) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    setFlashId(el.dataset["blockId"] ?? null);
  }, [data]);

  if (isError) {
    return (
      <div className="wrap">
        <EmptyState
          icon="allNotes"
          title="This note isn't available"
          body="It may have been deleted or moved out of your workspace."
          actions={
            <ButtonLink href="/library" variant="primary">
              Back to Library
            </ButtonLink>
          }
        />
      </div>
    );
  }
  if (isPending) {
    return (
      <div className="reader" role="status" aria-busy="true" aria-label="Loading note">
        <Skeleton className="mt-10 h-10 w-full rounded-md" />
        <Skeleton className="mt-12 h-12 w-3/4" />
        <Skeleton className="mt-8 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </div>
    );
  }

  const path = data.note.folderId ? folderPath(folders, data.note.folderId) : [];
  const sourceById = new Map(data.sources.map((s) => [s.id, s]));

  return (
    <>
      <Toolbar>
        <Crumbs
          items={[
            { label: "Library", href: "/library" },
            ...path.map((f) => ({ label: f.name, href: libraryHref({ folder: f.id }) })),
            { label: data.note.title },
          ]}
        />
        <ToolbarSpacer />
      </Toolbar>
      <article className="reader" aria-labelledby="note-title">
        <SourceStrip detail={data} />
        <header className="reader-head">
          {path.length ? (
            <p className="eyebrow reader-eyebrow">{path.map((f) => f.name).join(" · ")}</p>
          ) : null}
          <h1 id="note-title" className="reader-title">
            {data.note.title}
          </h1>
          {data.note.lede ? <p className="reader-lede">{data.note.lede}</p> : null}
          <p className="t-foot">
            {formatDate(data.note.createdAt)} · {data.blocks.length} blocks · filed by{" "}
            {data.note.filedBy === "agent" ? "the agent" : "you"}
          </p>
        </header>
        <div className="reader-body" ref={bodyRef}>
          <div className="reader-content prose" data-qa-obstacle>
            {data.blocks.map((block, i) => (
              <BlockView
                key={block.id}
                block={block}
                source={block.sourceId ? sourceById.get(block.sourceId) : undefined}
                index={i}
                active={activeBlockId === block.id}
                onActivate={setActiveBlockId}
                provenanceOpen={openBlockId === block.id}
                onProvenanceOpenChange={(open) => setOpenBlockId(open ? block.id : null)}
                editing={editingId === block.id}
                onEdit={() => setEditingId(block.id)}
                onEditDone={() => setEditingId(null)}
                onViewInSource={() => undefined}
                flash={flashId === block.id}
              />
            ))}
          </div>
          {wide ? (
            <MarginCallouts
              blocks={data.blocks}
              bodyRef={bodyRef}
              activeBlockId={activeBlockId}
              onActivate={setActiveBlockId}
              onOpen={(id) => setOpenBlockId(id)}
            />
          ) : null}
        </div>
      </article>
    </>
  );
}
