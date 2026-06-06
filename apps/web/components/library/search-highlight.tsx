import type { SearchHit } from "@mastertutor/contracts";
import { Fragment } from "react";

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
