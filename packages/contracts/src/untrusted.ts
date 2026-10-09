const MARKER = /<(\/?)untrusted_page_content/gi;

/**
 * Page-derived text sent to the model is wrapped (spec §5.5). Enforcement never relies on this:
 * it only tells the model which text is data. Inner markers are escaped so content cannot
 * close the wrapper or open a fake one.
 */
export function wrapUntrusted(origin: string | null, content: string): string {
  const safeOrigin = (origin ?? "unknown").replace(/["<>&]/g, "");
  const safeContent = content.replace(MARKER, "&lt;$1untrusted_page_content");
  return `<untrusted_page_content origin="${safeOrigin}">\n${safeContent}\n</untrusted_page_content>`;
}

const ENVELOPE =
  /^<untrusted_page_content origin="([^"<>&]*)">\n([\s\S]*)\n<\/untrusted_page_content>$/;

/**
 * The inverse of wrapUntrusted, for readers of stored tool results (the benchmark grader). It is
 * null when the text is not exactly one envelope. Escaped inner markers are restored.
 */
export function unwrapUntrusted(text: string): { origin: string; content: string } | null {
  const match = ENVELOPE.exec(text);
  if (!match) return null;
  return {
    origin: match[1]!,
    content: match[2]!.replace(/&lt;(\/?untrusted_page_content)/gi, "<$1"),
  };
}

/**
 * Page- and model-derived text is untrusted (spec §5.5; CLAUDE.md principle 3). This is the one
 * cleaner for every surface that shows it (S6): NFKC, no format characters (bidi overrides,
 * isolates, zero-width), control characters become spaces, whitespace collapses, and the result
 * is capped by code point. Invisible fillers go too, and stacks of combining marks are capped.
 * Callers render it inside <bdi> so it cannot reorder our own text.
 */
export const MAX_UNTRUSTED = 300;

export function untrustedText(
  text: string | null | undefined,
  max: number = MAX_UNTRUSTED,
): string {
  if (!text) return "";
  const clean = text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    // Invisible fillers that are not format characters: Hangul fillers and the braille blank.
    .replace(/[\u115F\u1160\u3164\uFFA0\u2800]/g, "")
    // A stack of combining marks taller than real text needs is cut to four.
    .replace(/(\p{M}{4})\p{M}+/gu, "$1")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : clean;
}
