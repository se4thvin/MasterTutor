import type { BlockSnippet, LocatedBlock } from "./types.ts";

/** Maps each block's text to the element and offsets it came from (spec §7.5 anchors). Self-contained. */
export function pageLocateBlocks(snippets: BlockSnippet[]): LocatedBlock[] {
  const lib = globalThis.__mtLib;
  const state = globalThis.__mtCapture;
  if (!lib || !state) throw new Error("capture_state_missing");
  const norm = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  let text = "";
  const spans: { node: Text; from: number; to: number }[] = [];
  lib.walkRendered(
    state.root,
    state.range,
    (node, raw) => {
      let piece = norm(raw);
      if ((text === "" || text.endsWith(" ")) && piece.startsWith(" ")) piece = piece.slice(1);
      if (!piece) return;
      spans.push({ node, from: text.length, to: text.length + piece.length });
      text += piece;
    },
    () => {
      if (text && !text.endsWith(" ")) text += " ";
    },
  );
  const none: LocatedBlock = { selector: null, xpath: null, start: null, end: null };
  let cursor = 0;
  return snippets.map((snippet) => {
    const head = norm(snippet.head).trim();
    if (!head) return none;
    const find = (needle: string) => {
      const forward = text.indexOf(needle, cursor);
      return forward >= 0 ? forward : text.indexOf(needle);
    };
    let start = find(head);
    let headLength = head.length;
    if (start < 0) {
      const short = head.split(" ").slice(0, 4).join(" ");
      start = short.length >= 8 ? find(short) : -1;
      headLength = short.length;
    }
    if (start < 0) return none;
    let end = start + headLength;
    const tail = norm(snippet.tail).trim();
    if (tail) {
      const at = text.indexOf(tail, Math.max(start, end - tail.length));
      if (at >= 0) end = at + tail.length;
    }
    cursor = end;
    const span = spans.find((s) => s.to > start);
    const owner = span?.node.parentElement ?? null;
    const block = owner?.closest(lib.BLOCK_SELECTOR);
    const target = block && state.root.contains(block) ? block : owner;
    return {
      selector: target ? lib.cssPath(target) : null,
      xpath: target ? lib.xpathOf(target) : null,
      start,
      end,
    };
  });
}
