import type { SearchHit } from "@mastertutor/contracts";
import Link from "next/link";
import { Fragment } from "react";
import { cx } from "@/lib/cx.ts";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits plain text around query terms; React renders every part as text (never HTML). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(escape);
  if (!terms.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

export const hitHref = (hit: SearchHit) =>
  `/notes/${hit.noteId}${hit.blockId ? `#block-${hit.blockId}` : ""}`;

export function SearchResults({
  hits,
  query,
  activeIndex,
  idPrefix,
  onPick,
}: {
  hits: SearchHit[];
  query: string;
  activeIndex?: number;
  idPrefix?: string;
  onPick?: () => void;
}) {
  return (
    <ul className="hits" aria-label="Search results">
      {hits.map((hit, i) => (
        <li
          key={`${hit.noteId}-${hit.blockId ?? "note"}-${i}`}
          id={idPrefix ? `${idPrefix}-${i}` : undefined}
          className={cx("hit", activeIndex === i && "hit-active")}
        >
          <Link href={hitHref(hit)} onClick={onPick} className="hit-link">
            <b className="hit-title">{hit.title}</b>
            <span className="hit-snippet">
              <Highlight text={hit.snippet} query={query} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
