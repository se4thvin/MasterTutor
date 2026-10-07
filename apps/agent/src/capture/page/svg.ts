/** Parses untrusted SVG text into an inert document and returns its allowlisted markup (capture world). */
export function pageSanitizeSvg(text: string): string | null {
  const lib = globalThis.__mtLib;
  if (!lib || text.length > 5_000_000) return null;
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  return lib.sanitizeSvg(doc.documentElement);
}
