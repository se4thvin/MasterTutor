"use client";

import type { NoteBlock, NoteDetail } from "@mastertutor/contracts";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { MEDIA } from "@/lib/breakpoints.ts";
import { cx } from "@/lib/cx.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { formatDateTime, hostOf } from "@/lib/notes/format.ts";
import { isRawHtmlTable } from "@/lib/notes/provenance.ts";
import { BlockMarkdown } from "./block-markdown.tsx";

const plainText = (block: NoteBlock) =>
  (block.originalMarkdown ?? block.markdown)
    .replace(/<[^>]*>/g, " ")
    .replace(/[#*_`>$|\\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The captured text as a read-only page. Each block is a div holding its markdown and a separate
 * pick button, never markdown inside a <button> (invalid nesting, and links/code stay usable).
 */
export function SourcePane({
  detail,
  activeBlockId,
  onPick,
}: {
  detail: NoteDetail;
  activeBlockId: string | null;
  onPick: (blockId: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const split = useMediaQuery(MEDIA.md);
  const first = useRef(true);
  useEffect(() => {
    const initial = first.current;
    first.current = false;
    // Stacked panes share the page scroll, so hover-driven scrolling would yank the page around;
    // only the arrival ("View in source") scrolls there.
    if (!activeBlockId || (!split && !initial)) return;
    refs.current.get(activeBlockId)?.scrollIntoView({ block: "nearest" });
  }, [activeBlockId, split]);

  const captured = detail.blocks.filter((b) => b.origin !== "user");
  const source = detail.sources[0];
  return (
    <section className="src-pane" aria-label="Captured source">
      <p className="src-bar t-foot">
        <Icon name="sealed" size="sm" />
        {source
          ? `${hostOf(source.url)} · captured ${formatDateTime(source.capturedAt)} · read-only`
          : "Captured text · read-only"}
      </p>
      <article className="src-page prose">
        {captured.map((block) => {
          const text = plainText(block);
          if (!text && !block.assetId) return null;
          return (
            <div
              key={block.id}
              ref={(el) => {
                if (el) refs.current.set(block.id, el);
                else refs.current.delete(block.id);
              }}
              className={cx("src-block", activeBlockId === block.id && "src-block-hot")}
            >
              {text ? (
                <BlockMarkdown
                  markdown={block.originalMarkdown ?? block.markdown}
                  allowHtml={isRawHtmlTable(block)}
                />
              ) : (
                <p className="t-foot">Captured image</p>
              )}
              <button
                type="button"
                className="src-pick"
                aria-label={`Show in note: ${text.slice(0, 80) || "captured image"}`}
                onClick={() => onPick(block.id)}
              >
                <Icon name="note" size="sm" />
              </button>
            </div>
          );
        })}
      </article>
    </section>
  );
}
