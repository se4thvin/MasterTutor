"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { folderPath } from "@/lib/folders/tree.ts";
import { libraryHref, parseLibraryParams } from "@/lib/library/params.ts";
import { FolderActions } from "./folder-actions.tsx";
import { FolderTree } from "./folder-tree.tsx";

export function useLibraryScope() {
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

export function LibraryHeader({
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

export function LibraryView() {
  return <LibraryHeader onDropNote={() => undefined} />;
}
