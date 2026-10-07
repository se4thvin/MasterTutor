"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useRouter } from "next/navigation";
import { m, useReducedMotion } from "motion/react";
import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { LayoutMotion } from "@/components/motion/layout-motion.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { transitions } from "@/lib/motion-tokens.ts";
import { Highlight, hitHref } from "./search-highlight.tsx";
import { useNoteSearch } from "./use-note-search.ts";

/**
 * The ⌘K palette's contents, loaded on demand (search-palette.tsx): the field, the results and
 * the gliding highlight (LayoutMotion). It ships in no route's first-load JS.
 */
export function PaletteBody({ onDone }: { onDone: () => void }) {
  return (
    <LayoutMotion>
      <PaletteSearch onDone={onDone} />
    </LayoutMotion>
  );
}

function PaletteSearch({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(-1);
  const { hits, settledQuery, isFetching } = useNoteSearch(q, null);
  // New results can be shorter than the list the cursor was on; never point past the end.
  const active = Math.min(cursor, hits.length - 1);
  const setActive = (next: number | ((current: number) => number)) =>
    setCursor(typeof next === "function" ? next(active) : next);
  const choose = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    onDone();
    router.push(hitHref(hit));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active < 0 ? 0 : active);
    }
  };
  const listed = hits.length > 0;
  return (
    <>
      <Dialog.Title className="sr-only">Search notes</Dialog.Title>
      <div className="palette-field">
        <Icon name="search" />
        <input
          role="combobox"
          aria-expanded={listed}
          aria-controls={listed ? "palette-list" : undefined}
          aria-activedescendant={active >= 0 && listed ? `palette-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Search every block"
          placeholder="Search every block"
          autoFocus
          maxLength={500}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className="kbd" aria-hidden="true">
          esc
        </kbd>
      </div>
      {listed ? (
        <ul id="palette-list" role="listbox" aria-label="Results" className="palette-list">
          {hits.map((hit, i) => (
            <li
              key={`${hit.noteId}-${hit.blockId ?? "n"}-${i}`}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === active}
              className="hit"
              style={{ "--i": Math.min(i, 8) } as CSSProperties}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {i !== active ? null : reduceMotion ? (
                // Reduced motion: no layoutId, since motion's instant layout transition would still
                // paint one frame at the previous row.
                <span className="hit-highlight" aria-hidden="true" />
              ) : (
                // One highlight that glides to the selected row (layoutId), Spotlight-style.
                <m.span
                  layoutId="palette-hit"
                  className="hit-highlight"
                  aria-hidden="true"
                  transition={transitions.spring}
                />
              )}
              <b className="hit-title">{hit.title}</b>
              <span className="hit-snippet">
                <Highlight text={hit.snippet} query={settledQuery} />
              </span>
            </li>
          ))}
        </ul>
      ) : settledQuery && !isFetching ? (
        // Outside the listbox: a listbox may only own options.
        <p className="palette-empty" role="status">
          No notes match “{settledQuery}”.
        </p>
      ) : null}
    </>
  );
}
