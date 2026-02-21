"use client";

import type { NoteBlock, SourceView } from "@mastertutor/contracts";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cx } from "@/lib/cx.ts";
import { formatTimestamp } from "@/lib/notes/format.ts";
import { isRawHtmlTable, showsVerifyCheck, statusOf } from "@/lib/notes/provenance.ts";
import { AssetImage } from "./asset-image.tsx";
import { BlockMarkdown } from "./block-markdown.tsx";
import { ProvenancePopover } from "./provenance-popover.tsx";
import { VerifyCheck } from "./verify-check.tsx";

export const EDITABLE_TYPES = new Set([
  "heading",
  "paragraph",
  "list",
  "quote",
  "commentary",
  "code",
  "math",
  "table",
  "transcript",
]);

export interface BlockViewProps {
  block: NoteBlock;
  source: SourceView | undefined;
  index: number;
  active: boolean;
  onActivate: (id: string | null) => void;
  provenanceOpen: boolean;
  onProvenanceOpenChange: (open: boolean) => void;
  editing: boolean;
  onEdit: () => void;
  onEditDone: () => void;
  onViewInSource: () => void;
  /** Plays the arrival flash; kept in state so a re-render cannot wipe a class set by hand. */
  flash?: boolean;
}

export function BlockContent({ block }: { block: NoteBlock }) {
  const plainCaption = block.markdown.replace(/[*_`#>]/g, "").trim();
  switch (block.type) {
    case "image":
    case "figure":
    case "keyframe":
      return (
        <figure className="blk-figure">
          {block.assetId ? (
            <AssetImage
              assetId={block.assetId}
              alt={plainCaption || "Captured image"}
              className="blk-img"
            />
          ) : null}
          {block.type !== "image" && block.markdown ? (
            <figcaption className="cap">
              {block.type === "keyframe" && block.anchor?.tStart !== undefined ? (
                <b>{formatTimestamp(block.anchor.tStart)} </b>
              ) : null}
              <BlockMarkdown markdown={block.markdown} />
            </figcaption>
          ) : null}
        </figure>
      );
    case "transcript":
      return (
        <div className="blk-transcript">
          {block.anchor?.tStart !== undefined ? (
            <span className="mono blk-time">[{formatTimestamp(block.anchor.tStart)}]</span>
          ) : null}
          <div>
            <BlockMarkdown markdown={block.markdown} />
          </div>
        </div>
      );
    case "commentary":
      return (
        <aside className="blk-commentary" aria-label="Agent's note">
          <span className="eyebrow">Agent's note</span>
          <BlockMarkdown markdown={block.markdown} />
        </aside>
      );
    default:
      return (
        <div
          className={cx(block.type === "table" && "blk-scroll")}
          {...(block.type === "table"
            ? { tabIndex: 0, role: "region", "aria-label": "Table, scrolls sideways" }
            : {})}
        >
          <BlockMarkdown markdown={block.markdown} allowHtml={isRawHtmlTable(block)} />
        </div>
      );
  }
}

const BlockEditor = dynamic(() => import("./block-editor.tsx").then((m) => m.BlockEditor), {
  ssr: false,
  loading: () => (
    <div role="status" aria-busy="true" aria-label="Loading editor">
      <Skeleton className="h-24 w-full rounded-md" />
    </div>
  ),
});

export function BlockView(props: BlockViewProps) {
  const {
    block,
    source,
    index,
    active,
    onActivate,
    provenanceOpen,
    onProvenanceOpenChange,
    editing,
    onEdit,
    onEditDone,
    onViewInSource,
    flash = false,
  } = props;
  const status = statusOf(block);
  const trigger = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  // Save, Cancel and Esc unmount the editor, which held focus; hand it back to the block.
  const finishEdit = () => {
    refocus.current = true;
    onEditDone();
  };
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    trigger.current?.focus();
  }, [editing]);
  return (
    <div
      id={`block-${block.id}`}
      data-block-id={block.id}
      className={cx("blk", active && "blk-hot", flash && "blk-flash", `blk-${status}`)}
      onPointerEnter={() => onActivate(block.id)}
      // The pointer moves into the (portalled) popover; the block stays active while it is open.
      onPointerLeave={() => {
        if (!provenanceOpen) onActivate(null);
      }}
    >
      <ProvenancePopover
        block={block}
        source={source}
        index={index}
        open={provenanceOpen}
        onOpenChange={onProvenanceOpenChange}
        onEdit={onEdit}
        onViewInSource={onViewInSource}
        editable={EDITABLE_TYPES.has(block.type)}
        triggerRef={trigger}
      />
      {editing ? <BlockEditor block={block} onDone={finishEdit} /> : <BlockContent block={block} />}
      {showsVerifyCheck(block) ? (
        <div className="blk-actions" data-qa="review-actions">
          {!block.verified ? (
            <Badge tone="warn" icon="needsReview">
              Needs review
            </Badge>
          ) : null}
          <VerifyCheck block={block} />
        </div>
      ) : null}
    </div>
  );
}
