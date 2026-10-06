"use client";

import type { FolderView } from "@mastertutor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Icon, type IconName } from "@/components/ui/icon.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { cx } from "@/lib/cx.ts";
import { FOLDER_DRAG_TYPE, NOTE_DRAG_TYPE, getDragged, setDragged } from "@/lib/folders/drag.ts";
import {
  buildFolderTree,
  canMoveFolder,
  flattenVisible,
  folderPath,
  type FolderNode,
} from "@/lib/folders/tree.ts";
import { libraryHref, parseLibraryParams, type LibraryScope } from "@/lib/library/params.ts";

type Row =
  | { key: "all" | "unfiled"; label: string; icon: IconName; level: 1; node: null }
  | { key: string; label: string; icon: IconName; level: number; node: FolderNode };

export function FolderTree({
  onNavigate,
  onDropNote,
}: {
  onNavigate?: () => void;
  onDropNote: (noteId: string, folderId: string | null) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = parseLibraryParams(search);
  const scope: LibraryScope = pathname.startsWith("/library") ? params.folder : "";
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery(orpc.folders.tree.queryOptions({ input: {} }));
  const folders = useMemo(() => data?.folders ?? [], [data]);
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  // Reveal the current folder by opening its ancestors (not the folder itself), once per scope
  // and once the folders have loaded. Adjusting state while rendering is React's sanctioned way.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState<string | null>(null);
  if (revealed !== scope && folders.length > 0) {
    setRevealed(scope);
    if (scope !== "" && scope !== "all" && scope !== "unfiled") {
      const ancestors = folderPath(folders, scope)
        .slice(0, -1)
        .map((f) => f.id);
      if (ancestors.some((id) => !expanded.has(id))) {
        setExpanded(new Set([...expanded, ...ancestors]));
      }
    }
  }

  const rows: Row[] = useMemo(
    () => [
      { key: "all", label: "All notes", icon: "allNotes", level: 1, node: null },
      { key: "unfiled", label: "Unfiled", icon: "unfiled", level: 1, node: null },
      ...flattenVisible(tree, expanded).map((node) => ({
        key: node.folder.id,
        label: node.folder.name,
        icon: (expanded.has(node.folder.id)
          ? "folderOpen"
          : node.children.length
            ? "folderNested"
            : "folder") as IconName,
        level: node.depth,
        node,
      })),
    ],
    [tree, expanded],
  );
  const [focusKeyState, setFocusKey] = useState<string>(scope === "" ? "all" : scope);
  // A collapsed or deleted row cannot hold the roving tab stop, or the tree would be unreachable.
  const focusKey = rows.some((r) => r.key === focusKeyState) ? focusKeyState : "all";
  const [dropKey, setDropKey] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLLIElement>());

  const go = (key: string) => {
    router.push(libraryHref({ ...params, folder: key, q: "" }));
    onNavigate?.();
  };
  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  const focusRow = (key: string | undefined) => {
    if (!key) return;
    setFocusKey(key);
    refs.current.get(key)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = rows.findIndex((r) => r.key === focusKey);
    const row = rows[index];
    if (!row) return;
    const handled = () => event.preventDefault();
    switch (event.key) {
      case "ArrowDown":
        handled();
        focusRow(rows[Math.min(rows.length - 1, index + 1)]?.key);
        break;
      case "ArrowUp":
        handled();
        focusRow(rows[Math.max(0, index - 1)]?.key);
        break;
      case "Home":
        handled();
        focusRow(rows[0]?.key);
        break;
      case "End":
        handled();
        focusRow(rows[rows.length - 1]?.key);
        break;
      case "ArrowRight":
        if (row.node?.children.length) {
          handled();
          if (!expanded.has(row.key)) toggle(row.key, true);
          else focusRow(row.node.children[0]?.folder.id);
        }
        break;
      case "ArrowLeft":
        if (row.node) {
          handled();
          if (expanded.has(row.key)) toggle(row.key, false);
          else if (row.node.folder.parentId) focusRow(row.node.folder.parentId);
        }
        break;
      case "Enter":
      case " ":
        handled();
        go(row.key);
        break;
    }
  };

  const moveFolder = async (folderId: string, parentId: string | null) => {
    const key = orpc.folders.tree.queryKey({ input: {} });
    const previous = qc.getQueryData<{ folders: FolderView[] }>(key);
    qc.setQueryData<{ folders: FolderView[] }>(key, (old) =>
      old ? { folders: old.folders.map((f) => (f.id === folderId ? { ...f, parentId } : f)) } : old,
    );
    try {
      await api.folders.move({ folderId, parentId });
    } catch {
      qc.setQueryData(key, previous);
      toast({
        title: "Couldn't move the folder.",
        description: "Nothing changed.",
        icon: "needsReview",
        tone: "danger",
      });
    } finally {
      await qc.invalidateQueries({ queryKey: key });
    }
  };

  const accepts = (row: Row, event: DragEvent): boolean => {
    const dragged = getDragged();
    const types = event.dataTransfer.types;
    if (dragged?.kind === "note" && types.includes(NOTE_DRAG_TYPE)) return row.key !== "all";
    if (dragged?.kind === "folder" && types.includes(FOLDER_DRAG_TYPE)) {
      if (row.key === "unfiled") return false;
      const parentId = row.key === "all" ? null : row.key;
      return dragged.id !== row.key && canMoveFolder(folders, dragged.id, parentId);
    }
    return false;
  };

  const onDrop = (row: Row, event: DragEvent) => {
    event.preventDefault();
    setDropKey(null);
    // Decide before clearing the dragged item: accepts() reads it.
    const dragged = getDragged();
    const accepted = dragged !== null && accepts(row, event);
    setDragged(null);
    if (!dragged || !accepted) return;
    const target = row.key === "all" || row.key === "unfiled" ? null : row.key;
    if (dragged.kind === "note") onDropNote(dragged.id, target);
    else void moveFolder(dragged.id, target);
  };

  return (
    <ul role="tree" aria-label="Folders" className="tree" onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const current = row.key === scope;
        const isFolder = row.node !== null;
        return (
          <li
            key={row.key}
            ref={(el) => {
              if (el) refs.current.set(row.key, el);
              else refs.current.delete(row.key);
            }}
            role="treeitem"
            aria-level={row.level}
            aria-selected={current}
            aria-expanded={row.node?.children.length ? expanded.has(row.key) : undefined}
            aria-label={row.label}
            tabIndex={row.key === focusKey ? 0 : -1}
            className={cx(
              "tree-row",
              current && "tree-row-current",
              dropKey === row.key && "tree-row-drop",
            )}
            style={{ paddingInlineStart: `${0.6 + (row.level - 1) * 0.875}rem` }}
            draggable={isFolder}
            onFocus={() => setFocusKey(row.key)}
            onClick={() => go(row.key)}
            onDragStart={(e) => {
              if (!isFolder) return;
              setDragged({ kind: "folder", id: row.key });
              e.dataTransfer.setData(FOLDER_DRAG_TYPE, row.key);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDragged(null)}
            onDragOver={(e) => {
              if (accepts(row, e)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropKey(row.key);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setDropKey((k) => (k === row.key ? null : k));
            }}
            onDrop={(e) => onDrop(row, e)}
          >
            {row.node?.children.length ? (
              <span
                className="tree-disclosure"
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(row.key);
                }}
              >
                <Icon name={expanded.has(row.key) ? "chevronDown" : "chevronRight"} size="sm" />
              </span>
            ) : (
              <span className="tree-disclosure" aria-hidden="true" />
            )}
            <Icon name={row.icon} size="sm" />
            <span className="tree-label">{row.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
