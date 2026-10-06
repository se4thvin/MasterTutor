"use client";

import type { FolderView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { IconButton } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { canCreateFolder } from "@/lib/folders/tree.ts";
import { libraryHref } from "@/lib/library/params.ts";
import { FolderNameSheet, type FolderNameTarget } from "./folder-name-sheet.tsx";

/** Folder actions for the current Library scope (keyboard- and touch-reachable everywhere). */
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
