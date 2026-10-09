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
  const location = (
    target: Element | null,
    start: number | null,
    end: number | null,
  ): LocatedBlock => {
    if (!target) return none;
    const domOrder: number[] = [];
    let current: Node = target;
    while (current.parentNode) {
      const parent = current.parentNode;
      domOrder.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
      current = parent;
      if (current instanceof ShadowRoot) {
        domOrder.unshift(0);
        current = current.host;
      }
    }
    return { selector: lib.cssPath(target), xpath: lib.xpathOf(target), start, end, domOrder };
  };
  let cursor = 0;
  return snippets.map((snippet) => {
    const head = norm(snippet.head).trim();
    const fallback = () =>
      location(snippet.selector ? document.querySelector(snippet.selector) : null, null, null);
    if (!head) return fallback();
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
    if (start < 0) return fallback();
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
    // Element-relative offsets are stable whether the same block is captured alone or in a page.
    const base = target ? (spans.find((s) => target.contains(s.node))?.from ?? start) : start;
    return location(target, start - base, end - base);
  });
}
