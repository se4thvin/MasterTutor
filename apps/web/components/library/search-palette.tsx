"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { cx } from "@/lib/cx.ts";
import { Highlight, hitHref } from "./search-results.tsx";
import { useNoteSearch } from "./use-note-search.ts";

export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="palette-viewport">
          <Dialog.Popup className="palette">
            {open ? <PaletteBody onDone={() => onOpenChange(false)} /> : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
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
              className={cx("hit", i === active && "hit-active")}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
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
