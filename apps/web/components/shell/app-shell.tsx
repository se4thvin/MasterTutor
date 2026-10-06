"use client";

import type { InfiniteData } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { FolderTree } from "@/components/library/folder-tree.tsx";
import { SearchPalette } from "@/components/library/search-palette.tsx";
import { useMoveNote } from "@/components/library/use-move-note.ts";
import { orpc } from "@/lib/api/client.ts";
import { useHotkey } from "@/lib/hooks/use-hotkey.ts";
import { useSignOut } from "./use-sign-out.ts";
import type { NotesPage } from "@/lib/notes/cache.ts";
import type { Viewer } from "@/lib/server/viewer.ts";
import { KillBanner } from "./kill-banner.tsx";
import { Sidebar } from "./sidebar.tsx";

/** The sidebar tree has no note list of its own, so it finds the dropped note's folder in the cache. */
function SidebarFolders() {
  const move = useMoveNote();
  const qc = useQueryClient();
  return (
    <FolderTree
      onDropNote={(noteId, folderId) => {
        const lists = qc.getQueriesData<InfiniteData<NotesPage> | NotesPage>({
          queryKey: orpc.notes.list.key(),
        });
        const from =
          lists
            .flatMap(([, data]) =>
              data ? ("pages" in data ? data.pages.flatMap((p) => p.items) : data.items) : [],
            )
            .find((n) => n.id === noteId)?.folderId ?? null;
        void move(noteId, folderId, from);
      }}
    />
  );
}

export function AppShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  useHotkey({ key: "k", meta: true }, () => setSearchOpen(true));
  // Declared after useHotkey, so its listener is attached first. Tests wait for this marker
  // instead of racing hydration.
  useEffect(() => {
    document.documentElement.dataset["hotkeys"] = "ready";
    return () => {
      delete document.documentElement.dataset["hotkeys"];
    };
  }, []);
  const signOut = useSignOut();
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar
        viewer={viewer}
        onSignOut={signOut}
        libraryTree={
          <Suspense>
            <SidebarFolders />
          </Suspense>
        }
      />
      <main id="main" className="main" tabIndex={-1}>
        <KillBanner />
        {children}
      </main>
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
