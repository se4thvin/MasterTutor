const MARKER = /\s?\[(Q[1-9][0-9]{0,2})\]/g;

/** Server-side citation check (spec §7.6): a marker that names no stored result is removed. */
export function checkCitations(
  text: string,
  known: ReadonlySet<string>,
): { text: string; citations: string[]; removed: string[] } {
  const citations = new Set<string>();
  const removed = new Set<string>();
  const cleaned = text.replace(MARKER, (marker, id: string) => {
    if (known.has(id)) {
      citations.add(id);
      return marker;
    }
    removed.add(id);
    return "";
  });
  return { text: cleaned, citations: [...citations], removed: [...removed] };
}
