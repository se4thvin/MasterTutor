import { normalizeText } from "./text.ts";

const encode = (value: string) => encodeURIComponent(value).replace(/-/g, "%2D");

/** A scroll-to-text fragment (`#:~:text=start,end`) for a block; null when there is no text. */
export function textFragment(text: string): string | null {
  const words = normalizeText(text)
    .split(" ")
    .filter((word) => word.length > 0);
  if (words.length === 0) return null;
  const fragment =
    words.length <= 8
      ? `#:~:text=${encode(words.join(" "))}`
      : `#:~:text=${encode(words.slice(0, 4).join(" "))},${encode(words.slice(-4).join(" "))}`;
  return fragment.length <= 2_000 ? fragment : null;
}
