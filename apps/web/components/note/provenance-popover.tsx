"use client";

import type { NoteBlock, SourceView } from "@mastertutor/contracts";
import { useState, type Ref } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Popover, PopoverPanel } from "@/components/ui/popover.tsx";
import { cx } from "@/lib/cx.ts";
import { provenanceOf } from "@/lib/notes/provenance.ts";

export function ProvenancePopover({
  block,
  source,
  index,
  open,
  onOpenChange,
  onEdit,
  onViewInSource,
  editable,
  triggerRef,
}: {
  block: NoteBlock;
  source: SourceView | undefined;
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onViewInSource: () => void;
  editable: boolean;
  /** The block's focus home: editing returns focus here. */
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const p = provenanceOf(block, source);
  const [showOriginal, setShowOriginal] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Popover.Trigger
        ref={triggerRef}
        className={cx("gutter-btn", `gutter-${p.status}`)}
        aria-label={`Provenance for block ${index + 1}: ${p.statusLabel}`}
      >
        <Icon name={p.icon} size="sm" />
      </Popover.Trigger>
      <PopoverPanel label="Block provenance" side="left" align="start">
        <div className="prov">
          <div className="prov-head">
            <Badge tone={p.tone} icon={p.icon}>
              {p.statusLabel}
            </Badge>
            <span className="t-foot">
              {p.originLabel}
              {p.where ? ` · ${p.where}` : ""}
            </span>
          </div>
          {p.snippet ? <blockquote className="prov-quote">{p.snippet}</blockquote> : null}
          <dl className="prov-kv">
            {p.selector ? (
              <>
                <dt>Selector</dt>
                <dd className="tabular">{p.selector}</dd>
              </>
            ) : null}
            {p.hashShort ? (
              <>
                <dt>SHA-256</dt>
                <dd className="tabular">{p.hashShort}</dd>
              </>
            ) : null}
          </dl>
          {block.edited && block.originalMarkdown ? (
            <div>
              <Button variant="plain" onClick={() => setShowOriginal((s) => !s)}>
                {showOriginal ? "Hide original" : "Show original"}
              </Button>
              {showOriginal ? <p className="prov-original">{block.originalMarkdown}</p> : null}
            </div>
          ) : null}
          <div className="prov-actions">
            {editable ? (
              <Button
                onClick={() => {
                  onOpenChange(false);
                  onEdit();
                }}
                icon="edit"
              >
                Edit block
              </Button>
            ) : null}
            {block.origin !== "model" ? (
              <Button
                onClick={() => {
                  onOpenChange(false);
                  onViewInSource();
                }}
                icon="split"
              >
                View in source
              </Button>
            ) : null}
            {p.openUrl ? (
              <a
                className="btn btn-plain"
                href={p.openUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open on page <Icon name="external" size="sm" />
              </a>
            ) : null}
          </div>
        </div>
      </PopoverPanel>
    </Popover.Root>
  );
}
