/** Schemes a download link may carry. A Markdown data URL is what the fixture API serves. */
const SAFE_PROTOCOLS = new Set(["https:", "http:", "blob:"]);

/** Returns the URL only if it can download a file and cannot run script; anything else is null. */
export function safeDownloadUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (SAFE_PROTOCOLS.has(url.protocol)) return raw;
  return url.protocol === "data:" && /^data:text\/markdown[;,]/i.test(raw) ? raw : null;
}
