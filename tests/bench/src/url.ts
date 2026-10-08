/** A document's identity: origin and path, ignoring query, hash and a trailing slash. */
export function documentKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

/** The same document: origin and path, ignoring query, hash and a trailing slash. */
export function sameDocument(a: string, b: string): boolean {
  return documentKey(a) === documentKey(b);
}
