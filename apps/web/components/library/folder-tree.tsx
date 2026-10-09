"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Icon, type IconName } from "@/components/ui/icon.tsx";
import { MarqueeText } from "@/components/ui/marquee-text.tsx";
import { cx } from "@/lib/cx.ts";
import { FOLDER_DRAG_TYPE, acceptsDrop, getDragged, setDragged } from "@/lib/folders/drag.ts";
import {
  buildFolderTree,
  flattenVisible,
  folderPath,
  type FolderNode,
} from "@/lib/folders/tree.ts";
import { FolderMark } from "./folder-mark.tsx";
import { useFolders } from "./use-folders.ts";
import { useMoveFolder } from "./use-move-folder.ts";
import { libraryHref, parseLibraryParams, type LibraryScope } from "@/lib/library/params.ts";

interface Place {
  size: number;
  pos: number;
}
type Row = (
  | { key: "all" | "unfiled"; label: string; icon: IconName; level: 1; node: null }
  | { key: string; label: string; icon: IconName; level: number; node: FolderNode }
) &
  Place;

/** Position among siblings for every folder; the two fixed rows count as part of the top level. */
function placesOf(tree: readonly FolderNode[]): Map<string, Place> {
  const places = new Map<string, Place>();
  const walk = (siblings: readonly FolderNode[], offset: number, size: number) => {
    siblings.forEach((node, i) => {
      places.set(node.folder.id, { size, pos: offset + i + 1 });
      walk(node.children, 0, node.children.length);
    });
  };
  walk(tree, 2, tree.length + 2);
  return places;
}

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
  const folders = useFolders();
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

  const rows: Row[] = useMemo(() => {
    const places = placesOf(tree);
    const top = tree.length + 2;
    return [
      { key: "all", label: "All notes", icon: "allNotes", level: 1, node: null, size: top, pos: 1 },
      {
        key: "unfiled",
        label: "Unfiled",
        icon: "unfiled",
        level: 1,
        node: null,
        size: top,
        pos: 2,
      },
      ...flattenVisible(tree, expanded).map((node) => ({
        ...(places.get(node.folder.id) ?? { size: 1, pos: 1 }),
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
    ];
  }, [tree, expanded]);
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

  const moveFolder = useMoveFolder();

  const accepts = (row: Row, event: DragEvent): boolean =>
    acceptsDrop(row.key, folders, event.dataTransfer.types);

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
            aria-setsize={row.size}
            aria-posinset={row.pos}
            aria-selected={current}
            aria-expanded={row.node?.children.length ? expanded.has(row.key) : undefined}
            aria-label={row.label}
            title={row.label}
            data-marquee-host=""
            tabIndex={row.key === focusKey ? 0 : -1}
            className={cx(
              "tree-row",
              current && "tree-row-current",
              dropKey === row.key && "tree-row-drop",
            )}
            style={{ "--level": row.level } as CSSProperties}
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
                data-open={expanded.has(row.key) ? "" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(row.key);
                }}
              >
                <Icon name="chevronRight" size="sm" />
              </span>
            ) : (
              <span className="tree-disclosure" aria-hidden="true" />
            )}
            <FolderMark
              name={row.icon}
              openName={row.node ? "folderOpen" : null}
              lift={dropKey === row.key}
            />
            <MarqueeText text={row.label} className="tree-label" />
          </li>
        );
      })}
    </ul>
  );
}
