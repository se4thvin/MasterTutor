/**
 * Whether a request came from an internal caller (D50 review C-1, I-1): its Host is one of the
 * configured internal Hosts (contracts' internalWebHosts). X-Forwarded-* prove nothing here: Next
 * adds them to every request itself.
 */
export function isInternalRequest(request: Request, internalHosts: readonly string[]): boolean {
  const host = request.headers.get("host");
  return host !== null && internalHosts.includes(host);
}
