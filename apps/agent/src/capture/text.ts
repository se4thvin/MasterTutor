const SCRIPT_DIGITS = /[\u00B2\u00B3\u00B9\u2070-\u2079\u2080-\u2089]/g;

/**
 * Verification text rules (spec §7.5): NFKC, invisible characters removed, quotes straightened.
 * Super- and subscript digits stand apart first, so `10²` and `10<sup>2</sup>` both read `10 2`
 * (NFKC alone would fold the first into `102`). ZWNJ and ZWJ carry meaning in Persian and Indic
 * text; dropping them is safe only because both sides of every comparison go through this.
 */
export function normalizeText(text: string): string {
  return text
    .replace(SCRIPT_DIGITS, (digit) => ` ${digit} `)
    .normalize("NFKC")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(text: string): string[] {
  return (
    normalizeText(text)
      .toLocaleLowerCase("en")
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  );
}

function counts(words: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const word of words) map.set(word, (map.get(word) ?? 0) + 1);
  return map;
}

export interface Coverage {
  coverage: number;
  sourceTokens: number;
  matchedTokens: number;
}

/** Share of source tokens (as a multiset) present in the captured text. */
export function coverageOf(source: string, captured: string): Coverage {
  const want = counts(tokens(source));
  const have = counts(tokens(captured));
  let sourceTokens = 0;
  let matchedTokens = 0;
  for (const [word, n] of want) {
    sourceTokens += n;
    matchedTokens += Math.min(n, have.get(word) ?? 0);
  }
  return {
    coverage: sourceTokens === 0 ? 1 : matchedTokens / sourceTokens,
    sourceTokens,
    matchedTokens,
  };
}

export function combineCoverage(parts: readonly Coverage[]): Coverage {
  const sourceTokens = parts.reduce((sum, part) => sum + part.sourceTokens, 0);
  const matchedTokens = parts.reduce((sum, part) => sum + part.matchedTokens, 0);
  return {
    coverage: sourceTokens === 0 ? 1 : matchedTokens / sourceTokens,
    sourceTokens,
    matchedTokens,
  };
}

/**
 * One reference from several views of the same text (page text, content root): each token keeps
 * its larger count. Joining the views would double counts and loosen per-block precision.
 */
export function mergeReferences(texts: readonly string[]): string {
  const merged = new Map<string, number>();
  for (const text of texts)
    for (const [word, n] of counts(tokens(text)))
      merged.set(word, Math.max(merged.get(word) ?? 0, n));
  return [...merged].map(([word, n]) => Array(n).fill(word).join(" ")).join(" ");
}

/**
 * Block precision against one source, tokenised once (B5 review I-3): scoring many blocks against
 * a long reference costs each block's own tokens, not the whole source again.
 */
export function precisionAgainst(source: string): (blockText: string) => number {
  const have = counts(tokens(source));
  return (blockText) => {
    let total = 0;
    let matched = 0;
    for (const [word, n] of counts(tokens(blockText))) {
      total += n;
      matched += Math.min(n, have.get(word) ?? 0);
    }
    return total === 0 ? 1 : matched / total;
  };
}

/** Share of a block's tokens found in the source: 1 means nothing in the block is foreign to the page. */
export function blockPrecision(blockText: string, source: string): number {
  return precisionAgainst(source)(blockText);
}
