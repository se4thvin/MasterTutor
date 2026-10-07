/** Verification text rules (spec §7.5): NFKC, invisible characters removed, quotes straightened. */
export function normalizeText(text: string): string {
  return text
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
      .match(/[\p{L}\p{N}]+/gu) ?? []
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

/** Share of a block's tokens found in the source: 1 means nothing in the block is foreign to the page. */
export function blockPrecision(blockText: string, source: string): number {
  return coverageOf(blockText, source).coverage;
}
