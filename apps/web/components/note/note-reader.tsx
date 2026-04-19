"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RollingNumber } from "@/components/bits/rolling-number.tsx";
import { RubberSegment, type SegmentItem } from "@/components/bits/rubber-segment.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { durations } from "@/lib/motion-tokens.ts";
import { orpc } from "@/lib/api/client.ts";
import { MEDIA } from "@/lib/breakpoints.ts";
import { cx } from "@/lib/cx.ts";
import { folderPath } from "@/lib/folders/tree.ts";
import { firstDraftedBlock } from "@/lib/notes/edit-drafts.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { libraryHref } from "@/lib/library/params.ts";
import { formatDate } from "@/lib/notes/format.ts";
import { BlockView } from "./block-view.tsx";
import { ExportButton } from "./export-button.tsx";
import { MarginCallouts } from "./margin-callouts.tsx";
import { SourcePane } from "./source-pane.tsx";
import { SourceStrip } from "./source-strip.tsx";

type View = "note" | "source";

const LAYOUT_ITEMS: SegmentItem<View>[] = [
  { value: "note", label: "Note", icon: "note" },
  { value: "source", label: "Source | Note", icon: "split" },
];

export function NoteReader({ noteId }: { noteId: string }) {
  const { data, isPending, isError } = useQuery(orpc.notes.get.queryOptions({ input: { noteId } }));
  const folders = useQuery(orpc.folders.tree.queryOptions({ input: {} })).data?.folders ?? [];
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  // The arrival highlight lasts as long as the flash; under reduced motion it is a static tint,
  // which must not linger until the next pick.
  useEffect(() => {
    if (flashId === null) return undefined;
    const timer = setTimeout(() => setFlashId(null), durations.shimmer);
    return () => clearTimeout(timer);
  }, [flashId]);
  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null);
  const wide = useMediaQuery(MEDIA.lg);
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view: View = search.get("view") === "source" ? "source" : "note";
  const setView = (next: View) => {
    if (next === "note") setPinnedBlockId(null);
    router.replace(next === "source" ? `${pathname}?view=source` : pathname, { scroll: false });
  };
  const bodyRef = useRef<HTMLDivElement>(null);

  // An edit that never reached the server (failed, or the session ended mid-save) reopens once.
  const restoredDraft = useRef(false);
  useEffect(() => {
    if (!data || restoredDraft.current) return;
    restoredDraft.current = true;
    const drafted = firstDraftedBlock(data.blocks.map((b) => b.id));
    if (drafted) setEditingId(drafted);
  }, [data]);

  useEffect(() => {
    if (!data || !window.location.hash.startsWith("#block-")) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    setFlashId(el.dataset["blockId"] ?? null);
  }, [data]);

  const focusNoteBlock = (id: string) => {
    setPinnedBlockId(null);
    setActiveBlockId(id);
    document.getElementById(`block-${id}`)?.scrollIntoView({ block: "center" });
    // Drop the class for a frame so the flash restarts on a repeat pick.
    setFlashId(null);
    requestAnimationFrame(() => setFlashId(id));
  };

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
  // The block to highlight in both panes: the hovered one, else the one "View in source" chose
  // (hover events fired by the layout shift must not erase that choice).
  const shownActive = activeBlockId ?? (view === "source" ? pinnedBlockId : null);
  const sourceById = new Map(data.sources.map((s) => [s.id, s]));
  const verifiedCount = data.blocks.filter((b) => b.verified).length;

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
        <RubberSegment
          aria-label="Layout"
          size="sm"
          fit="content"
          items={LAYOUT_ITEMS}
          value={view}
          onChange={setView}
        />
        <ExportButton detail={data} />
      </Toolbar>
      <div className={cx("note-body", view === "source" && "note-body-split")}>
        {view === "source" ? (
          <SourcePane detail={data} activeBlockId={shownActive} onPick={focusNoteBlock} />
        ) : null}
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
              {formatDate(data.note.createdAt)} · {data.blocks.length} blocks ·{" "}
              <RollingNumber value={String(verifiedCount)} /> verified · filed by{" "}
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
                  active={shownActive === block.id}
                  onActivate={setActiveBlockId}
                  provenanceOpen={openBlockId === block.id}
                  onProvenanceOpenChange={(open) => setOpenBlockId(open ? block.id : null)}
                  editing={editingId === block.id}
                  onEdit={() => setEditingId(block.id)}
                  onEditDone={() => setEditingId(null)}
                  onViewInSource={() => {
                    setActiveBlockId(null);
                    setPinnedBlockId(block.id);
                    setView("source");
                  }}
                  flash={flashId === block.id}
                />
              ))}
            </div>
            {wide && view === "note" ? (
              <MarginCallouts
                blocks={data.blocks}
                bodyRef={bodyRef}
                activeBlockId={shownActive}
                onActivate={setActiveBlockId}
                onOpen={(id) => setOpenBlockId(id)}
              />
            ) : null}
          </div>
        </article>
      </div>
    </>
  );
}
