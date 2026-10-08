/**
 * Returns a URL that can download a file and cannot run script, or null. Relative URLs (what
 * notes.export returns once wired) resolve against `origin`. Accepted: same-origin http(s),
 * cross-origin https (signed object-store links), blob:, and the zip data URL the fixture
 * API serves.
 */
export function safeDownloadUrl(raw: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin === origin && /^https?:$/.test(url.protocol)) return url.href;
  if (url.protocol === "https:" || url.protocol === "blob:") return raw;
  return url.protocol === "data:" && /^data:application\/zip;base64,/i.test(raw) ? raw : null;
}
