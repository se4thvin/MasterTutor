import type { IconName } from "@/components/ui/icon.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import type { FolderNode } from "@/lib/folders/tree.ts";

/**
 * The folder picker both move sheets use: an optional root destination (Unfiled or Top level),
 * then each folder indented by depth. The current location is marked with aria-current.
 */
export function FolderPickList({
  root,
  folders,
  currentId,
  onPick,
  empty,
}: {
  root?: { label: string; icon: IconName } | null;
  folders: FolderNode[];
  /** The folder the item is in now; null means the root. Undefined marks nothing. */
  currentId?: string | null;
  onPick: (folderId: string | null) => void;
  empty?: string;
}) {
  return (
    <ul className="move-list">
      {root ? (
        <li>
          <button
            type="button"
            className="move-row"
            aria-current={currentId === null ? "true" : undefined}
            onClick={() => onPick(null)}
          >
            <Icon name={root.icon} size="sm" />
            <span>{root.label}</span>
          </button>
        </li>
      ) : null}
      {folders.map((node) => (
        <li key={node.folder.id}>
          <button
            type="button"
            className="move-row"
            style={{ paddingInlineStart: `${0.75 + (node.depth - 1) * 1}rem` }}
            aria-current={currentId === node.folder.id ? "true" : undefined}
            onClick={() => onPick(node.folder.id)}
          >
            <Icon name="folder" size="sm" />
            <span>{node.folder.name}</span>
          </button>
        </li>
      ))}
      {!root && folders.length === 0 && empty ? <li className="move-empty">{empty}</li> : null}
    </ul>
  );
}
