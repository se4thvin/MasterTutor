"use client";

import type { NoteSummary, SourceKind } from "@mastertutor/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RubberSegment, type SegmentItem } from "@/components/bits/rubber-segment.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { LayoutMotion } from "@/components/motion/layout-motion.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { SearchField } from "@/components/ui/search-field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { transitions } from "@/lib/motion-tokens.ts";
import { childFolders, folderPath } from "@/lib/folders/tree.ts";
import {
  libraryHref,
  parseLibraryParams,
  type LibraryParams,
  type LibraryViewMode,
} from "@/lib/library/params.ts";
import { KIND_LABEL } from "@/lib/notes/format.ts";
import { FolderActions } from "./folder-actions.tsx";
import { FolderTiles } from "./folder-tiles.tsx";
import { FolderTree } from "./folder-tree.tsx";
import { SearchResults } from "./search-results.tsx";
import { MoveSheet } from "./move-sheet.tsx";
import { NoteCard } from "./note-card.tsx";
import { useDeleteNote } from "./use-delete-note.ts";
import { useMoveNote } from "./use-move-note.ts";
import { useNoteSearch } from "./use-note-search.ts";

function useLibraryScope() {
  const params = parseLibraryParams(useSearchParams());
  const { data } = useQuery(orpc.folders.tree.queryOptions({ input: {} }));
  const folders = data?.folders ?? [];
  const path =
    params.folder !== "all" && params.folder !== "unfiled"
      ? folderPath(folders, params.folder)
      : [];
  const current = path[path.length - 1] ?? null;
  const scopeLabel = params.folder === "unfiled" ? "Unfiled" : (current?.name ?? "Library");
  return { params, folders, path, current, scopeLabel };
}

function LibraryHeader({
  onDropNote,
}: {
  onDropNote: (noteId: string, folderId: string | null) => void;
}) {
  const { params, folders, path, current, scopeLabel } = useLibraryScope();
  const [sheet, setSheet] = useState(false);
  const crumbs = [
    { label: "Library", href: libraryHref({ ...params, folder: "all" }) },
    ...(params.folder === "unfiled"
      ? [{ label: "Unfiled" }]
      : path.map((f) => ({ label: f.name, href: libraryHref({ ...params, folder: f.id }) }))),
  ];
  return (
    <>
      <Toolbar>
        <Crumbs items={crumbs} />
        <ToolbarSpacer />
        <Button className="lg:hidden" icon="folder" onClick={() => setSheet(true)}>
          Folders
        </Button>
        <FolderActions folders={folders} current={current} />
      </Toolbar>
      <Sheet open={sheet} onOpenChange={setSheet} title="Folders">
        <FolderTree onNavigate={() => setSheet(false)} onDropNote={onDropNote} />
      </Sheet>
      <div className="wrap">
        <PageHead
          title={scopeLabel}
          lede="Every block traces back to the exact place it came from."
        />
      </div>
    </>
  );
}

/**
 * Empty-state copy for the current view (I5). All notes is library-wide, not a folder; a folder
 * with subfolder tiles above must not claim "nothing here"; a kind filter names the kind, since
 * the scope may still hold notes of other kinds.
 */
function emptyCopy(params: LibraryParams, showTiles: boolean): { title: string; body?: string } {
  const body =
    params.folder === "all" && showTiles
      ? "Notes appear here when the agent files them."
      : showTiles
        ? undefined
        : "Notes appear here when the agent files them, or when you move them in.";
  if (params.kind) return { title: `No ${KIND_LABEL[params.kind]} notes here yet`, body };
  if (params.folder === "all" && showTiles) return { title: "No notes yet", body };
  if (showTiles) return { title: "No notes in this folder yet", body };
  return { title: "Nothing here yet", body };
}

const URL_WRITE_DEBOUNCE_MS = 250;
const KIND_ITEMS: SegmentItem<"all" | SourceKind>[] = [
  { value: "all", label: "All" },
  { value: "web", label: "Web" },
  { value: "pdf", label: "PDF" },
  { value: "youtube", label: "Video" },
];
const VIEW_ITEMS: SegmentItem<LibraryViewMode>[] = [
  { value: "grid", label: "Grid", icon: "grid", hideLabel: true },
  { value: "list", label: "List", icon: "list", hideLabel: true },
];

export function LibraryView() {
  const router = useRouter();
  const { params, folders } = useLibraryScope();
  const notes = useInfiniteQuery(
    orpc.notes.list.infiniteOptions({
      input: (cursor: string | null) => ({
        folder: params.folder,
        kind: params.kind,
        limit: 50,
        cursor,
      }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  // Filter again on the client so a note that just moved out of this scope leaves at once.
  const items = (notes.data?.pages.flatMap((p) => p.items) ?? []).filter((n) =>
    params.folder === "all"
      ? true
      : params.folder === "unfiled"
        ? n.folderId === null
        : n.folderId === params.folder,
  );
  const set = (patch: Partial<LibraryParams>) =>
    router.replace(libraryHref({ ...params, ...patch }), { scroll: false });

  // The URL owns the query. `draft` is only what is being typed before the debounced URL write
  // lands; it is dropped once the URL catches up or the folder changes, so a folder click and
  // back/forward always show the URL's query.
  const [draft, setDraft] = useState<string | null>(null);
  const [seenFolder, setSeenFolder] = useState(params.folder);
  if (seenFolder !== params.folder) {
    setSeenFolder(params.folder);
    setDraft(null);
  }
  if (draft !== null && draft === params.q) setDraft(null);
  const query = draft ?? params.q;
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  });
  const writeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(writeTimer.current), []);
  useEffect(() => clearTimeout(writeTimer.current), [params.folder]);
  const typeQuery = (value: string) => {
    setDraft(value);
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(
      () => router.replace(libraryHref({ ...latest.current, q: value }), { scroll: false }),
      URL_WRITE_DEBOUNCE_MS,
    );
  };
  const clearQuery = () => {
    clearTimeout(writeTimer.current);
    setDraft("");
    set({ q: "" });
  };
  const search = useNoteSearch(query, params.kind);
  const searching = query.trim() !== "";
  const moveNote = useMoveNote();
  const deleteNote = useDeleteNote();
  const [moving, setMoving] = useState<NoteSummary | null>(null);
  const [deleting, setDeleting] = useState<NoteSummary | null>(null);
  const reduceMotion = useReducedMotion();
  const dropNote = (noteId: string, folderId: string | null) => {
    const note = items.find((n) => n.id === noteId);
    if (note) void moveNote(noteId, folderId, note.folderId);
  };
  // The current folder's subfolders show as tiles (FolderFloat), except while searching or in Unfiled.
  const tilesParent = params.folder === "all" ? null : params.folder;
  const showTiles =
    !searching && params.folder !== "unfiled" && childFolders(folders, tilesParent).length > 0;
  const empty = emptyCopy(params, showTiles);

  return (
    <>
      <LibraryHeader onDropNote={dropNote} />
      <div className="wrap">
        <div className="libbar">
          <div className="libbar-search">
            <SearchField
              label="Search the library"
              value={query}
              onChange={typeQuery}
              maxLength={500}
              placeholder="Search every block"
              shortcut="⌘K"
            />
          </div>
          <RubberSegment
            aria-label="Filter by type"
            items={KIND_ITEMS}
            value={params.kind ?? "all"}
            onChange={(v) => set({ kind: v === "all" ? null : v })}
          />
          <span className="toolbar-spacer" />
          <RubberSegment
            aria-label="View"
            size="sm"
            items={VIEW_ITEMS}
            value={params.view}
            onChange={(v) => set({ view: v })}
          />
        </div>
        {showTiles ? (
          <FolderTiles
            folders={folders}
            parentId={tilesParent}
            params={params}
            onDropNote={dropNote}
          />
        ) : null}
        {searching ? (
          search.hits.length ? (
            <SearchResults hits={search.hits} query={search.settledQuery} />
          ) : search.settledQuery && !search.isFetching ? (
            <EmptyState
              icon="search"
              eyebrow="Search"
              title="No results"
              body={`No notes match “${search.settledQuery}”. Search covers titles and every captured block.`}
              actions={
                <>
                  <ButtonLink
                    href={`/new?goal=${encodeURIComponent(search.settledQuery)}`}
                    variant="primary"
                    size="lg"
                  >
                    Take notes on this
                  </ButtonLink>
                  <Button size="lg" onClick={clearQuery}>
                    Clear search
                  </Button>
                </>
              }
            />
          ) : null
        ) : notes.isError && !notes.data ? (
          <LoadError
            title="Couldn't load your notes."
            onRetry={() => void notes.refetch()}
            retrying={notes.isFetching}
          />
        ) : notes.isPending ? (
          <div
            className="notes"
            data-view={params.view}
            role="status"
            aria-busy="true"
            aria-label="Loading notes"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card">
                <Skeleton className="card-cover" />
                <Skeleton className="mt-4 h-4 w-1/3" />
                <Skeleton className="mt-2 h-5 w-3/4" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="allNotes"
            eyebrow={params.kind ? KIND_LABEL[params.kind] : undefined}
            title={empty.title}
            body={empty.body}
            actions={
              <ButtonLink href="/new" variant="primary" size="lg">
                New task
              </ButtonLink>
            }
          />
        ) : (
          <LayoutMotion>
            <div className="notes" data-view={params.view}>
              {/* A card that leaves fades and settles out; the cards after it glide into place
                  (layout, parked item). popLayout takes the leaver out of flow at once. Under
                  reduced motion layout is off: motion's instant layout transition would still
                  paint one frame at the old place. */}
              <AnimatePresence initial={false} mode="popLayout">
                {items.map((note, i) => (
                  <m.div
                    key={note.id}
                    layout={reduceMotion ? false : "position"}
                    className="card-slot"
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ ...transitions.exit, layout: transitions.spring }}
                  >
                    <NoteCard
                      note={note}
                      view={params.view}
                      index={i}
                      onMove={setMoving}
                      onDelete={setDeleting}
                    />
                  </m.div>
                ))}
              </AnimatePresence>
            </div>
          </LayoutMotion>
        )}
        <MoveSheet note={moving} onClose={() => setMoving(null)} />
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete “${deleting?.title ?? ""}”?`}
          description="This removes the note and its blocks. Its captured sources stay with any other notes."
          confirmLabel="Delete Note"
          destructive
          onConfirm={() => deleting && void deleteNote(deleting)}
        />
        {!searching && notes.hasNextPage ? (
          <div className="flex justify-center pb-12">
            <Button onClick={() => void notes.fetchNextPage()} disabled={notes.isFetchingNextPage}>
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
