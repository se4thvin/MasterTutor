import type { SearchHit } from "@mastertutor/contracts";
import Link from "next/link";
import { Highlight, hitHref } from "./search-highlight.tsx";

export function SearchResults({ hits, query }: { hits: SearchHit[]; query: string }) {
  return (
    <ul className="hits" aria-label="Search results">
      {hits.map((hit, i) => (
        <li key={`${hit.noteId}-${hit.blockId ?? "note"}-${i}`} className="hit">
          <Link href={hitHref(hit)} className="hit-link">
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
