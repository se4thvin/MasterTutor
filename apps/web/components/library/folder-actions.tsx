"use client";

import type { FolderView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { IconButton } from "@/components/ui/button.tsx";
import { ChunkBoundary } from "@/components/ui/chunk-boundary.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { lazyComponent } from "@/lib/hooks/lazy-component.ts";
import { canCreateFolder } from "@/lib/folders/tree.ts";
import { libraryHref } from "@/lib/library/params.ts";
import { FolderNameSheet, type FolderNameTarget } from "./folder-name-sheet.tsx";

/** Folder actions for the current Library scope (keyboard- and touch-reachable everywhere). */
// The folder move sheet stays out of the library's first load.
const { Component: FolderMoveSheet, usePrefetch: usePrefetchFolderMoveSheet } = lazyComponent(() =>
  import("./folder-move-sheet.tsx").then((mod) => mod.FolderMoveSheet),
);

export function FolderActions({
  folders,
  current,
}: {
  folders: FolderView[];
  current: FolderView | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<FolderNameTarget | null>(null);
  const [confirm, setConfirm] = useState(false);
  // A snapshot taken when the sheet opens: the move updates the tree cache at once, and the live
  // folder's new parentId would drop the destination row mid-receive (B1).
  const [moving, setMoving] = useState<FolderView | null>(null);
  // Mounted from the first "Move folder to…" on, so its close animation always plays.
  const [moveSheetUsed, setMoveSheetUsed] = useState(false);
  if (moving && !moveSheetUsed) setMoveSheetUsed(true);
  usePrefetchFolderMoveSheet();
  const moveSheetFailed = () => {
    setMoving(null);
    setMoveSheetUsed(false);
  };

  const remove = async () => {
    if (!current) return;
    try {
      await api.folders.delete({ folderId: current.id });
      router.push(libraryHref({ folder: "all" }));
      toast({ title: `Deleted “${current.name}”`, icon: "delete" });
    } catch {
      toast({ title: "Couldn't delete the folder.", icon: "needsReview", tone: "danger" });
    } finally {
      await qc.invalidateQueries({ queryKey: orpc.folders.key() });
      await qc.invalidateQueries({ queryKey: orpc.notes.key() });
    }
  };

  return (
    <>
      <Menu.Root>
        <Menu.Trigger render={<IconButton icon="more" label="Folder actions" />} />
        <MenuPanel>
          <MenuItem
            icon="folderAdd"
            onSelect={() => setSheet({ mode: "create", parentId: null, parentName: null })}
          >
            New folder
          </MenuItem>
          {current && canCreateFolder(folders, current.id) ? (
            <MenuItem
              icon="folderNested"
              onSelect={() =>
                setSheet({ mode: "create", parentId: current.id, parentName: current.name })
              }
            >
              New subfolder
            </MenuItem>
          ) : null}
          {current ? (
            <MenuItem
              icon="edit"
              onSelect={() =>
                setSheet({ mode: "rename", folderId: current.id, name: current.name })
              }
            >
              Rename
            </MenuItem>
          ) : null}
          {current ? (
            <MenuItem icon="move" onSelect={() => setMoving(current)}>
              Move folder to…
            </MenuItem>
          ) : null}
          {current ? (
            <MenuItem icon="delete" destructive onSelect={() => setConfirm(true)}>
              Delete folder…
            </MenuItem>
          ) : null}
        </MenuPanel>
      </Menu.Root>
      <FolderNameSheet
        target={sheet}
        onClose={() => setSheet(null)}
        onDone={(id) => sheet?.mode === "create" && router.push(libraryHref({ folder: id }))}
      />
      {moveSheetUsed ? (
        <ChunkBoundary what="Move folder to…" onFailed={moveSheetFailed}>
          <Suspense fallback={null}>
            <FolderMoveSheet folder={moving} folders={folders} onClose={() => setMoving(null)} />
          </Suspense>
        </ChunkBoundary>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete “${current?.name ?? ""}”?`}
        description="Its subfolders are deleted too. Notes inside move to Unfiled."
        confirmLabel="Delete Folder"
        destructive
        onConfirm={() => void remove()}
      />
    </>
  );
}
