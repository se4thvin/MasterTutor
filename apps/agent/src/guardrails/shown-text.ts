/**
 * Model-written text a person sees in the run view (a decide step's caption and its reasoning
 * summary). The model never sees a vault secret, but its text can quote the page, so it gets the
 * same screen as an approval excerpt (M13): cleaned first (NFKC, so full-width forms match; no
 * format or control characters, so a zero-width split cannot hide one), then redacted, then capped
 * (so a cut never shows part of a secret). Paragraph breaks survive; the view renders plain text.
 */
export function shownModelText(
  text: string | null | undefined,
  max: number,
  redact: (text: string) => string,
): string | null {
  if (!text) return null;
  const clean = text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Cf}\p{Cs}]/gu, "")
    .replace(/[^\S\n]|\p{Cc}(?<!\n)/gu, " ")
    .split("\n")
    .map((line) => line.replace(/ +/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chars = Array.from(redact(clean));
  const shown = chars.slice(0, max).join("").trim();
  return shown === "" ? null : shown;
}
