/** Characters OCR confuses, folded to one form on both sides of a comparison. */
const CONFUSABLE: Record<string, string> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  "|": "1",
  Z: "2",
  S: "5",
  B: "8",
  G: "6",
  T: "7",
};

/**
 * `text` as OCR might read it, folded: upper case, letters and digits only (separators and
 * symbols dropped), each confusable character in one form. The local pixel screens match a
 * secret's folded form in folded OCR text (QA-099); the canary tests compare with it too.
 */
export function foldConfusables(text: string): string {
  return Array.from(
    text.toUpperCase().replace(/[^A-Z0-9|]/g, ""),
    (char) => CONFUSABLE[char] ?? char,
  ).join("");
}
