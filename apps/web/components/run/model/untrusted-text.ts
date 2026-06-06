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
