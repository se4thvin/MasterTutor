"use client";

import type { NoteBlock } from "@mastertutor/contracts";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { cx } from "@/lib/cx.ts";
import { layoutCallouts, type PlacedCallout } from "@/lib/notes/callout-layout.ts";
import { calloutFor } from "@/lib/notes/provenance.ts";

const GAP = 12;
const LEADER_Y = 14;
const CAPTION_Y = 9;
const FALLBACK_GUTTER = 40;
// Past the block's hover tile, which overhangs the content column by 0.9rem.
const DOT_X = 18;

/**
 * Cutaway margin captions (D22). Rendered only where the margin column exists (above 1180px);
 * below that, the gutter badges carry the status. Leaders live in the gutter column and are
 * clipped to it, so they never cross the timeline or the content.
 */
export function MarginCallouts({
  blocks,
  bodyRef,
  activeBlockId,
  onActivate,
  onOpen,
}: {
  blocks: NoteBlock[];
  bodyRef: RefObject<HTMLDivElement | null>;
  activeBlockId: string | null;
  onActivate: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const entries = useMemo(
    () =>
      blocks.flatMap((b) => {
        const c = calloutFor(b);
        return c ? [{ block: b, callout: c }] : [];
      }),
    [blocks],
  );
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const leadersRef = useRef<SVGSVGElement>(null);
  const [placed, setPlaced] = useState<PlacedCallout[]>([]);
  const [anchors, setAnchors] = useState(new Map<string, number>());
  const [height, setHeight] = useState(0);
  const [gutterWidth, setGutterWidth] = useState(FALLBACK_GUTTER);

  // useEffect, not useLayoutEffect: this mounts in the same commit as the body it measures,
  // so the parent's ref is only reliably set once effects run.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    const measure = () => {
      const bodyTop = body.getBoundingClientRect().top;
      const nextAnchors = new Map<string, number>();
      const items = entries.flatMap(({ block }) => {
        const el = document.getElementById(`block-${block.id}`);
        const caption = refs.current.get(block.id);
        if (!el || !caption) return [];
        const anchorTop = el.getBoundingClientRect().top - bodyTop;
        nextAnchors.set(block.id, anchorTop);
        return [{ id: block.id, anchorTop, height: caption.offsetHeight }];
      });
      setAnchors(nextAnchors);
      setHeight(body.offsetHeight);
      setGutterWidth(leadersRef.current?.getBoundingClientRect().width || FALLBACK_GUTTER);
      setPlaced(layoutCallouts(items, { gap: GAP, containerHeight: body.offsetHeight }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    // Web fonts change caption heights after the first paint.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [entries, bodyRef]);

  const byId = new Map(placed.map((p) => [p.id, p]));
  return (
    <>
      <svg
        ref={leadersRef}
        className="leaders"
        data-qa="leaders"
        data-qa-avoid
        aria-hidden="true"
        height={height}
      >
        {entries.map(({ block, callout }) => {
          const p = byId.get(block.id);
          const a = anchors.get(block.id);
          if (!p || p.hidden || a === undefined) return null;
          const y1 = a + LEADER_Y;
          const y2 = p.top + CAPTION_Y;
          return (
            <g
              key={block.id}
              className={cx(
                activeBlockId === block.id && "leader-on",
                callout.status === "needs_review" && "leader-signal",
              )}
            >
              <path d={`M ${DOT_X} ${y1} L ${gutterWidth} ${y2}`} />
              <circle cx={DOT_X} cy={y1} r="2.75" />
            </g>
          );
        })}
      </svg>
      <div className="callouts" data-qa-allow-clip>
        {entries.map(({ block, callout }, i) => {
          const p = byId.get(block.id);
          return (
            <button
              key={block.id}
              ref={(el) => {
                if (el) refs.current.set(block.id, el);
                else refs.current.delete(block.id);
              }}
              type="button"
              data-qa="callout"
              data-qa-avoid
              data-qa-obstacle
              className={cx("callout", activeBlockId === block.id && "callout-on")}
              style={
                {
                  top: p?.top ?? 0,
                  visibility: !p || p.hidden ? "hidden" : "visible",
                  "--i": Math.min(i, 8),
                } as CSSProperties
              }
              onPointerEnter={() => onActivate(block.id)}
              onPointerLeave={() => onActivate(null)}
              onClick={() => onOpen(block.id)}
            >
              <span className="cap">
                <b>{callout.lead}</b> {callout.text}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
