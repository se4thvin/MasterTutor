const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** NAME_MAX on Linux and macOS is 255 bytes for the whole name, extension included. */
const NAME_MAX = 255;
const utf8 = new TextEncoder();
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The longest prefix of whole graphemes that fits in `maxBytes` of UTF-8. */
function capBytes(value: string, maxBytes: number): string {
  let out = "";
  let used = 0;
  for (const { segment } of graphemes.segment(value)) {
    used += utf8.encode(segment).length;
    if (used > maxBytes) break;
    out += segment;
  }
  return out;
}

function safeName(title: string, extension: string): string {
  const maxBytes = NAME_MAX - extension.length;
  const clean = title
    .replace(/\p{Bidi_Control}/gu, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  const fit = (value: string) => capBytes(value, maxBytes).replace(/[\s.]+$/, "");
  const capped = fit(clean);
  const name = WINDOWS_RESERVED.test(capped) ? fit(`_${capped}`) : capped;
  return `${name || "note"}${extension}`;
}

/** The note inside the export archive. */
export const markdownFileName = (title: string): string => safeName(title, ".md");
/** The download itself: always a zip (decision 18), so the name and the bytes agree. */
export const archiveFileName = (title: string): string => safeName(title, ".zip");
