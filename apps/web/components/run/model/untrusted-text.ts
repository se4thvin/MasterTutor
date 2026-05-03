/**
 * Page- and model-derived text is untrusted (spec §5.5; CLAUDE.md principle 3). This is the one
 * cleaner for every surface that shows it (S6): NFKC, no format characters (bidi overrides,
 * isolates, zero-width), control characters become spaces, whitespace collapses, and the result
 * is capped by code point. Callers render it inside <bdi> so it cannot reorder our own text.
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
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : clean;
}
